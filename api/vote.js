// api/vote.js
// Serverless function to cast a vote
// Uses GitHub as storage backend with retry logic for conflicts

const { Octokit } = require('@octokit/rest');
const crypto = require('crypto');

// GitHub configuration
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_OWNER = 'jooskiii';
const GITHUB_REPO = 'blogmaxxer-image-api';
const GITHUB_BRANCH = 'main';
const DATA_PATH = 'data/data.json';
const VOTES_PATH = 'data/votes.json';

// Rate limiting configuration
const RATE_LIMIT_WINDOW = 60 * 60 * 1000; // 1 hour
const MAX_VOTES_PER_WINDOW = 10;
const MAX_RETRIES = 3; // Retry on conflicts

// In-memory rate limiting (resets on cold start)
const rateLimitMap = new Map();

// Helper: Hash IP for privacy
function hashIP(ip) {
  return crypto.createHash('sha256').update(ip + 'blogmaxxer-salt-2024').digest('hex');
}

// Helper: Get real IP
function getRealIP(req) {
  return req.headers['x-forwarded-for']?.split(',')[0].trim() 
    || req.headers['x-real-ip'] 
    || 'unknown';
}

// Helper: Check rate limit
function checkRateLimit(ipHash) {
  const now = Date.now();
  const userLimits = rateLimitMap.get(ipHash) || { count: 0, windowStart: now };
  
  if (now - userLimits.windowStart > RATE_LIMIT_WINDOW) {
    userLimits.count = 0;
    userLimits.windowStart = now;
  }
  
  if (userLimits.count >= MAX_VOTES_PER_WINDOW) {
    return false;
  }
  
  userLimits.count++;
  rateLimitMap.set(ipHash, userLimits);
  return true;
}

// Helper: Get file from GitHub
async function getGitHubFile(octokit, path) {
  try {
    const { data } = await octokit.repos.getContent({
      owner: GITHUB_OWNER,
      repo: GITHUB_REPO,
      path: path,
      ref: GITHUB_BRANCH
    });
    
    const content = Buffer.from(data.content, 'base64').toString('utf8');
    return {
      content: JSON.parse(content),
      sha: data.sha
    };
  } catch (err) {
    if (err.status === 404) {
      return { content: null, sha: null };
    }
    throw err;
  }
}

// Helper: Update file on GitHub with retry logic
async function updateGitHubFile(octokit, path, content, sha, message, retryCount = 0) {
  const contentEncoded = Buffer.from(JSON.stringify(content, null, 2)).toString('base64');
  
  try {
    await octokit.repos.createOrUpdateFileContents({
      owner: GITHUB_OWNER,
      repo: GITHUB_REPO,
      path: path,
      message: message,
      content: contentEncoded,
      sha: sha,
      branch: GITHUB_BRANCH
    });
  } catch (err) {
    // If conflict (409) and we have retries left, fetch fresh SHA and retry
    if (err.status === 409 && retryCount < MAX_RETRIES) {
      console.log(`Conflict detected, retrying (attempt ${retryCount + 1}/${MAX_RETRIES})`);
      await new Promise(resolve => setTimeout(resolve, 500)); // Brief delay
      
      // Get fresh file with updated SHA
      const freshFile = await getGitHubFile(octokit, path);
      
      // Retry with fresh SHA
      await updateGitHubFile(octokit, path, content, freshFile.sha, message, retryCount + 1);
    } else {
      throw err;
    }
  }
}

// Main vote processing function with transaction-like behavior
async function processVote(octokit, blogId, ipHash) {
  let attempt = 0;
  
  while (attempt < MAX_RETRIES) {
    try {
      // Get fresh data on each attempt
      const [dataFile, votesFile] = await Promise.all([
        getGitHubFile(octokit, DATA_PATH),
        getGitHubFile(octokit, VOTES_PATH)
      ]);
      
      if (!dataFile.content) {
        throw new Error('Data file not found');
      }
      
      // Initialize votes structure if needed
      const votesData = votesFile.content || { votes: {} };
      const blogData = dataFile.content;
      
      // Find blog entry
      const blogEntry = blogData.entries.find(e => e.id === blogId);
      if (!blogEntry) {
        throw new Error('Blog not found');
      }
      
      // Check if user already voted
      if (!votesData.votes[blogId]) {
        votesData.votes[blogId] = {};
      }
      
      if (votesData.votes[blogId][ipHash]) {
        return { 
          error: 'You have already voted for this blog',
          alreadyVoted: true,
          status: 400
        };
      }
      
      // Record vote
      votesData.votes[blogId][ipHash] = Date.now();
      blogEntry.votes = (blogEntry.votes || 0) + 1;
      
      // Try to update both files
      await updateGitHubFile(
        octokit, 
        VOTES_PATH, 
        votesData, 
        votesFile.sha, 
        `Vote recorded for ${blogId}`
      );
      
      await updateGitHubFile(
        octokit, 
        DATA_PATH, 
        blogData, 
        dataFile.sha, 
        `Update vote count for ${blogId}`
      );
      
      // Success!
      return {
        success: true,
        newVoteCount: blogEntry.votes,
        message: 'Vote recorded successfully'
      };
      
    } catch (err) {
      attempt++;
      
      if (err.status === 409 && attempt < MAX_RETRIES) {
        // Conflict - wait briefly and retry
        console.log(`Vote conflict, retrying attempt ${attempt}/${MAX_RETRIES}`);
        await new Promise(resolve => setTimeout(resolve, 1000 * attempt)); // Exponential backoff
        continue;
      }
      
      // Non-conflict error or out of retries
      throw err;
    }
  }
  
  throw new Error('Failed to process vote after multiple retries');
}

module.exports = async (req, res) => {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  
  try {
    const { blogId } = req.body;
    
    if (!blogId) {
      return res.status(400).json({ error: 'blogId is required' });
    }
    
    // Get IP and check rate limit
    const ip = getRealIP(req);
    const ipHash = hashIP(ip);
    
    if (!checkRateLimit(ipHash)) {
      return res.status(429).json({ 
        error: 'Rate limit exceeded. Please try again later.',
        retryAfter: RATE_LIMIT_WINDOW / 1000
      });
    }
    
    // Initialize GitHub API
    const octokit = new Octokit({ auth: GITHUB_TOKEN });
    
    // Process vote with retry logic
    const result = await processVote(octokit, blogId, ipHash);
    
    if (result.error) {
      return res.status(result.status || 400).json(result);
    }
    
    res.json(result);
    
  } catch (err) {
    console.error('Error processing vote:', err);
    res.status(500).json({ 
      error: 'Failed to process vote',
      details: err.message 
    });
  }
};
