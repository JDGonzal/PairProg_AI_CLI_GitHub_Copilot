require('dotenv').config();
const express = require('express');
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = 3000;

// Parse ALLOWED_REPO_PATHS from environment (colon-separated or comma-separated)
const ALLOWED_REPO_PATHS = process.env.ALLOWED_REPO_PATHS
  ? process.env.ALLOWED_REPO_PATHS.split(/[,:;]/).filter(p => p.trim())
  : [process.cwd()];

console.log('Allowed repository paths:', ALLOWED_REPO_PATHS); 

app.use(express.json());
app.use(express.static('public'));

function isPathAllowed(resolvedPath, allowedPaths) {
  // Check if resolvedPath is within any of the allowed base directories
  for (const allowedPath of allowedPaths) {
    const realAllowedPath = fs.realpathSync(allowedPath);
    const relativePath = path.relative(realAllowedPath, resolvedPath);
    // If relative path doesn't start with .., it's within the allowed directory
    if (!relativePath.startsWith('..') && relativePath !== '.') {
      return true;
    }
  }
  return false;
}

function getDateString(daysAgo) {
  const date = new Date();
  date.setDate(date.getDate() - daysAgo);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function getCommits(repoPath, since, until) {
  try {
    const output = execFileSync(
      'git',
      ['-C', repoPath, 'log', `--since=${since} 00:00:00`, `--until=${until} 23:59:59`, '--pretty=format:%H\t%s\t%an'],
      { encoding: 'utf-8', timeout: 10000 }
    );
    if (!output.trim()) return [];
    return output.trim().split('\n').map(line => {
      const [hash, message, author] = line.split('\t');
      let filesChanged = 0;
      let linesAdded = 0;
      let linesDeleted = 0;

      try {
        const diffOutput = execFileSync(
          'git',
          ['-C', repoPath, 'diff-tree', '--numstat', hash],
          { encoding: 'utf-8', timeout: 5000 }
        );
        const lines = diffOutput.trim().split('\n').filter(l => l.trim());
        filesChanged = lines.length;
        lines.forEach(line => {
          const parts = line.split('\t');
          if (parts.length >= 3) {
            const added = parseInt(parts[0], 10) || 0;
            const deleted = parseInt(parts[1], 10) || 0;
            linesAdded += added;
            linesDeleted += deleted;
          }
        });
      } catch (diffError) {
        console.warn(`Could not fetch diff stats for ${hash}:`, diffError.message);
      }

      return {
        hash: hash.substring(0, 7),
        message,
        author,
        filesChanged,
        linesAdded,
        linesDeleted
      };
    });
  } catch (error) {
    console.error('Error fetching commits:', error.message);
    throw error;
  }
}

app.post('/api/standup', (req, res) => {
  const { repoPath } = req.body;

  if (!repoPath) {
    return res.status(400).json({ error: 'Repository path is required' });
  }

  // Resolve symlinks to get the real path
  let resolvedPath;
  try {
    resolvedPath = fs.realpathSync(repoPath);
  } catch (error) {
    return res.status(400).json({ error: 'Path does not exist or cannot be accessed' });
  }

  // Security check: Validate that resolvedPath is within an allowed directory
  if (!isPathAllowed(resolvedPath, ALLOWED_REPO_PATHS)) {
    return res.status(403).json({ error: 'Access to this repository path is not allowed' });
  }

  // Check if it's a git repository
  const gitDir = path.join(resolvedPath, '.git');
  if (!fs.existsSync(gitDir)) {
    return res.status(400).json({ error: 'Not a git repository' });
  }

  const today = getDateString(0);
  const yesterday = getDateString(1);

  const todayCommits = getCommits(resolvedPath, today, today);
  const yesterdayCommits = getCommits(resolvedPath, yesterday, yesterday);

  res.json({
    yesterday: yesterdayCommits,
    today: todayCommits
  });
});

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
