// api/unvote.js
// Serverless function to remove a vote
// Uses GitHub as storage backend with retry logic

const { Octokit } = require('@octokit/rest');
const crypto = require('crypto');

// GitHub configuration
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_OWNER = 'jooskiii';
const GITHUB_REPO = 'blogmaxxer-image-api';
const GITHUB_BRANCH = 'main';
const DATA_PATH = 'data/data.json';
const VOTES_PATH = 'data/votes.json';

// Configuration
const MAX_RETRIES = 3;

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
    if (err.status === 409 && retryCount < MAX_RETRIES) {
      console.log(`Conflict detected, retrying (attempt ${retryCount + 1}/${MAX_RETRIES})`);
      await new Promise(resolve => setTimeout(resolve, 500));
      
      const freshFile = await getGitHubFile(octokit, path);
      await updateGitHubFile(octokit, path, content, freshFile.sha, message, retryCount + 1);
    } else {
      throw err;
    }
  }
}

// Main unvote processing function
async function processUnvote(octokit, blogId, ipHash) {
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
      
      if (!votesFile.content) {
        throw new Error('Votes file not found');
      }
      
      const votesData = votesFile.content;
      const blogData = dataFile.content;
      
      // Find blog entry
      const blogEntry = blogData.entries.find(e => e.id === blogId);
      if (!blogEntry) {
        throw new Error('Blog not found');
      }
      
      // Check if user has voted
      if (!votesData.votes[blogId]?.[ipHash]) {
        return {
          error: 'You have not voted for this blog',
          notVoted: true,
          status: 400
        };
      }
      
      // Remove the vote
      delete votesData.votes[blogId][ipHash];
      blogEntry.votes = Math.max(0, (blogEntry.votes || 0) - 1);
      
      // Try to update both files
      await updateGitHubFile(
        octokit,
        VOTES_PATH,
        votesData,
        votesFile.sha,
        `Vote removed for ${blogId}`
      );
      
      await updateGitHubFile(
        octokit,
        DATA_PATH,
        blogData,
        dataFile.sha,
        `Update vote count for ${blogId} (removed)`
      );
      
      // Success!
      return {
        success: true,
        newVoteCount: blogEntry.votes,
        message: 'Vote removed successfully'
      };
      
    } catch (err) {
      attempt++;
      
      if (err.status === 409 && attempt < MAX_RETRIES) {
        console.log(`Unvote conflict, retrying attempt ${attempt}/${MAX_RETRIES}`);
        await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
        continue;
      }
      
      throw err;
    }
  }
  
  throw new Error('Failed to process unvote after multiple retries');
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
    
    // Get IP
    const ip = getRealIP(req);
    const ipHash = hashIP(ip);
    
    // Initialize GitHub API
    const octokit = new Octokit({ auth: GITHUB_TOKEN });
    
    // Process unvote with retry logic
    const result = await processUnvote(octokit, blogId, ipHash);
    
    if (result.error) {
      return res.status(result.status || 400).json(result);
    }
    
    res.json(result);
    
  } catch (err) {
    console.error('Error processing unvote:', err);
    res.status(500).json({
      error: 'Failed to process unvote',
      details: err.message
    });
  }
};
