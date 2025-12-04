// api/votes.js
// Serverless function to get vote counts and user vote status

const { Octokit } = require('@octokit/rest');
const crypto = require('crypto');

// GitHub configuration
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_OWNER = 'jooskiii';
const GITHUB_REPO = 'blogmaxxer-image-api';
const GITHUB_BRANCH = 'main';
const DATA_PATH = 'data/data.json';
const VOTES_PATH = 'data/votes.json';

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
    return JSON.parse(content);
  } catch (err) {
    if (err.status === 404) {
      return null;
    }
    throw err;
  }
}

module.exports = async (req, res) => {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  
  try {
    const ip = getRealIP(req);
    const ipHash = hashIP(ip);
    
    // Initialize GitHub API
    const octokit = new Octokit({ auth: GITHUB_TOKEN });
    
    // Get data from GitHub
    const [blogData, votesData] = await Promise.all([
      getGitHubFile(octokit, DATA_PATH),
      getGitHubFile(octokit, VOTES_PATH)
    ]);
    
    if (!blogData) {
      return res.status(500).json({ error: 'Data file not found' });
    }
    
    const votes = votesData?.votes || {};
    
    // Build response with vote counts and user vote status
    const response = {
      entries: blogData.entries.map(entry => ({
        id: entry.id,
        votes: entry.votes || 0,
        userVoted: votes[entry.id]?.[ipHash] ? true : false
      }))
    };
    
    res.json(response);
    
  } catch (err) {
    console.error('Error fetching votes:', err);
    res.status(500).json({ 
      error: 'Failed to fetch votes',
      details: err.message 
    });
  }
};
