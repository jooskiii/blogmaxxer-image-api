// api/blogs.js
// Serverless function to get blog data

const { Octokit } = require('@octokit/rest');

// GitHub configuration
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_OWNER = 'jooskiii';
const GITHUB_REPO = 'blogmaxxer-image-api';
const GITHUB_BRANCH = 'main';
const DATA_PATH = 'data/data.json';

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
  res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  
  try {
    // Initialize GitHub API
    const octokit = new Octokit({ auth: GITHUB_TOKEN });
    
    // Get blog data from GitHub
    const blogData = await getGitHubFile(octokit, DATA_PATH);
    
    if (!blogData) {
      return res.status(500).json({ error: 'Data file not found' });
    }
    
    res.json(blogData);
    
  } catch (err) {
    console.error('Error fetching blogs:', err);
    res.status(500).json({ 
      error: 'Failed to fetch blogs',
      details: err.message 
    });
  }
};
