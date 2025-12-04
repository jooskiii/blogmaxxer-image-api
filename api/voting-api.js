// /api/voting-api.js
// Backend voting API with IP-based rate limiting and hashed storage
// Place this in your /api/ folder

const express = require('express');
const crypto = require('crypto');
const fs = require('fs').promises;
const path = require('path');

const router = express.Router();

// Configuration
const DATA_FILE = path.join(__dirname, '../blogmaxxer/data.json');
const VOTES_FILE = path.join(__dirname, '../blogmaxxer/votes.json'); // Stores hashed IPs
const RATE_LIMIT_WINDOW = 60 * 60 * 1000; // 1 hour in milliseconds
const MAX_VOTES_PER_WINDOW = 10; // Max 10 votes per hour per IP

// In-memory rate limiting (resets on server restart - for persistent, use Redis)
const rateLimitMap = new Map();

// Helper: Hash IP address for privacy
function hashIP(ip) {
  return crypto.createHash('sha256').update(ip + 'blogmaxxer-salt-2024').digest('hex');
}

// Helper: Get real IP (handles proxies/load balancers)
function getRealIP(req) {
  return req.headers['x-forwarded-for']?.split(',')[0].trim() 
    || req.headers['x-real-ip'] 
    || req.connection.remoteAddress 
    || req.socket.remoteAddress;
}

// Helper: Check rate limit
function checkRateLimit(ipHash) {
  const now = Date.now();
  const userLimits = rateLimitMap.get(ipHash) || { count: 0, windowStart: now };
  
  // Reset window if expired
  if (now - userLimits.windowStart > RATE_LIMIT_WINDOW) {
    userLimits.count = 0;
    userLimits.windowStart = now;
  }
  
  if (userLimits.count >= MAX_VOTES_PER_WINDOW) {
    return false; // Rate limit exceeded
  }
  
  userLimits.count++;
  rateLimitMap.set(ipHash, userLimits);
  return true;
}

// Helper: Load votes data
async function loadVotes() {
  try {
    const data = await fs.readFile(VOTES_FILE, 'utf8');
    return JSON.parse(data);
  } catch (err) {
    // If file doesn't exist, return empty structure
    return { votes: {} }; // votes: { "blog-id": { "ip-hash": timestamp } }
  }
}

// Helper: Save votes data
async function saveVotes(votesData) {
  await fs.writeFile(VOTES_FILE, JSON.stringify(votesData, null, 2), 'utf8');
}

// Helper: Load blog data
async function loadBlogData() {
  const data = await fs.readFile(DATA_FILE, 'utf8');
  return JSON.parse(data);
}

// Helper: Save blog data
async function saveBlogData(blogData) {
  await fs.writeFile(DATA_FILE, JSON.stringify(blogData, null, 2), 'utf8');
}

// GET /api/votes - Get current vote counts
router.get('/votes', async (req, res) => {
  try {
    const blogData = await loadBlogData();
    const votesData = await loadVotes();
    const ip = getRealIP(req);
    const ipHash = hashIP(ip);
    
    // Return vote counts + which blogs this user has voted on
    const response = {
      entries: blogData.entries.map(entry => ({
        id: entry.id,
        votes: entry.votes || 0,
        userVoted: votesData.votes[entry.id]?.[ipHash] ? true : false
      }))
    };
    
    res.json(response);
  } catch (err) {
    console.error('Error fetching votes:', err);
    res.status(500).json({ error: 'Failed to fetch votes' });
  }
});

// POST /api/vote - Cast a vote
router.post('/vote', async (req, res) => {
  try {
    const { blogId } = req.body;
    
    if (!blogId) {
      return res.status(400).json({ error: 'blogId is required' });
    }
    
    const ip = getRealIP(req);
    const ipHash = hashIP(ip);
    
    // Check rate limit
    if (!checkRateLimit(ipHash)) {
      return res.status(429).json({ 
        error: 'Rate limit exceeded. Please try again later.',
        retryAfter: RATE_LIMIT_WINDOW / 1000 // seconds
      });
    }
    
    // Load data
    const blogData = await loadBlogData();
    const votesData = await loadVotes();
    
    // Find the blog entry
    const blogEntry = blogData.entries.find(e => e.id === blogId);
    if (!blogEntry) {
      return res.status(404).json({ error: 'Blog not found' });
    }
    
    // Check if user already voted
    if (!votesData.votes[blogId]) {
      votesData.votes[blogId] = {};
    }
    
    if (votesData.votes[blogId][ipHash]) {
      return res.status(400).json({ 
        error: 'You have already voted for this blog',
        alreadyVoted: true 
      });
    }
    
    // Record the vote
    votesData.votes[blogId][ipHash] = Date.now();
    blogEntry.votes = (blogEntry.votes || 0) + 1;
    
    // Save both files
    await saveVotes(votesData);
    await saveBlogData(blogData);
    
    res.json({ 
      success: true, 
      newVoteCount: blogEntry.votes,
      message: 'Vote recorded successfully'
    });
    
  } catch (err) {
    console.error('Error processing vote:', err);
    res.status(500).json({ error: 'Failed to process vote' });
  }
});

// DELETE /api/vote - Remove a vote (optional - for testing or if you want unvote feature)
router.delete('/vote', async (req, res) => {
  try {
    const { blogId } = req.body;
    
    if (!blogId) {
      return res.status(400).json({ error: 'blogId is required' });
    }
    
    const ip = getRealIP(req);
    const ipHash = hashIP(ip);
    
    // Load data
    const blogData = await loadBlogData();
    const votesData = await loadVotes();
    
    // Find the blog entry
    const blogEntry = blogData.entries.find(e => e.id === blogId);
    if (!blogEntry) {
      return res.status(404).json({ error: 'Blog not found' });
    }
    
    // Check if user has voted
    if (!votesData.votes[blogId]?.[ipHash]) {
      return res.status(400).json({ error: 'You have not voted for this blog' });
    }
    
    // Remove the vote
    delete votesData.votes[blogId][ipHash];
    blogEntry.votes = Math.max(0, (blogEntry.votes || 0) - 1);
    
    // Save both files
    await saveVotes(votesData);
    await saveBlogData(blogData);
    
    res.json({ 
      success: true, 
      newVoteCount: blogEntry.votes,
      message: 'Vote removed successfully'
    });
    
  } catch (err) {
    console.error('Error removing vote:', err);
    res.status(500).json({ error: 'Failed to remove vote' });
  }
});

module.exports = router;
