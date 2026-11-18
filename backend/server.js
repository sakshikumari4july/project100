
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const nodemailer = require('nodemailer');
const crypto = require('crypto');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 5001;
const UNIVERSITY_DOMAIN = '@dsu.edu.in';

app.use(helmet());
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:5175'
}));
app.use(express.json({ limit: '1mb' }));

// DATABASE CONNECTION
const pool = mysql.createPool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME || 'campusvoice',
  waitForConnections: true,
  connectionLimit: 10
});

// EMAIL CONFIGURATION
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'smtp.gmail.com',
  port: Number(process.env.SMTP_PORT || 587),
  secure: String(process.env.SMTP_SECURE) === 'true',
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS
  }
});

// HELPER FUNCTIONS
const isUniversityEmail = (email) =>
  /^[^\s@]+@dsu\.edu\.in$/i.test(email);

const createToken = (user) =>
  jwt.sign(
    { id: user.id, email: user.email, role: user.role },
    process.env.JWT_SECRET,
    { expiresIn: '1d' }
  );

const publicUser = (user) => ({
  id: user.id,
  name: user.name,
  email: user.email,
  role: user.role
});

const hashOtp = (otp) =>
  crypto.createHash('sha256').update(otp).digest('hex');

// FREE DUPLICATE POLL DETECTION
function normalizeQuestion(question) {
  const synonyms = {
    wifi: 'network',
    internet: 'network',
    connectivity: 'network',
    network: 'network',
    problem: 'issue',
    problems: 'issue',
    issue: 'issue',
    issues: 'issue',
    broken: 'issue',
    failure: 'issue'
  };

  const stopWords = new Set([
    'the', 'is', 'are', 'a', 'an', 'of', 'for',
    'to', 'in', 'on', 'at', 'and', 'or', 'with',
    'our', 'we', 'can', 'could', 'should', 'please',
    'campus', 'college', 'university'
  ]);

  return String(question)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(word => word.length > 1 && !stopWords.has(word))
    .map(word => synonyms[word] || word);
}

function calculateSimilarity(question1, question2) {
  const words1 = new Set(normalizeQuestion(question1));
  const words2 = new Set(normalizeQuestion(question2));

  if (!words1.size || !words2.size) return 0;

  const common = [...words1].filter(word => words2.has(word));
  const total = new Set([...words1, ...words2]).size;

  return common.length / total;
}

// AUTHENTICATION MIDDLEWARE
async function authenticate(req, res, next) {
  try {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ')
      ? header.slice(7)
      : null;

    if (!token) {
      return res.status(401).json({
        message: 'Login required.'
      });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    const [rows] = await pool.query(
      'SELECT id, name, email, role, is_verified FROM users WHERE id = ?',
      [decoded.id]
    );

    if (!rows.length || !rows[0].is_verified) {
      return res.status(401).json({
        message: 'Invalid account.'
      });
    }

    req.user = rows[0];
    next();
  } catch {
    return res.status(401).json({
      message: 'Session expired. Please login again.'
    });
  }
}

// ADMIN MIDDLEWARE
function requireAdmin(req, res, next) {
  if (req.user?.role !== 'admin') {
    return res.status(403).json({
      message: 'Admin access required.'
    });
  }

  next();
}

// HEALTH CHECK
app.get('/', (req, res) => {
  res.json({
    message: 'CampusVoice API is running.'
  });
});

app.get('/api/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');

    res.json({
      status: 'ok',
      database: 'connected',
      duplicateDetection: 'local',
      chatbot: 'local'
    });
  } catch {
    res.status(500).json({
      status: 'error',
      database: 'disconnected'
    });
  }
});

// STUDENT SIGNUP
app.post('/api/auth/signup', async (req, res) => {
  try {
    const name = String(req.body.name || '').trim();
    const email = String(req.body.email || '').trim().toLowerCase();
    const password = String(req.body.password || '');

    if (!name || !email || !password) {
      return res.status(400).json({
        message: 'All fields are required.'
      });
    }

    if (!isUniversityEmail(email)) {
      return res.status(400).json({
        message: 'Please use your DSU email ending with @dsu.edu.in.'
      });
    }

    if (password.length < 8) {
      return res.status(400).json({
        message: 'Password must contain at least 8 characters.'
      });
    }

    const [existing] = await pool.query(
      'SELECT id FROM users WHERE email = ?',
      [email]
    );

    if (existing.length) {
      return res.status(409).json({
        message: 'Account already exists. Please login.'
      });
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const otp = crypto.randomInt(100000, 1000000).toString();
    const otpHash = hashOtp(otp);
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000);

    await pool.query(
      `INSERT INTO pending_signups
       (name, email, password_hash, otp_hash, expires_at)
       VALUES (?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
       name = VALUES(name),
       password_hash = VALUES(password_hash),
       otp_hash = VALUES(otp_hash),
       expires_at = VALUES(expires_at)`,
      [name, email, passwordHash, otpHash, expiresAt]
    );

    try {
      await transporter.sendMail({
        from: process.env.SMTP_FROM || process.env.SMTP_USER,
        to: email,
        subject: 'CampusVoice - Email Verification',
        text: `Your CampusVoice verification OTP is ${otp}. It is valid for 5 minutes.`
      });
    } catch (mailError) {
      await pool.query(
        'DELETE FROM pending_signups WHERE email = ?',
        [email]
      );

      console.error('OTP email failed:', mailError.message);

      return res.status(500).json({
        message: 'Could not send OTP. Please check email configuration and try again.'
      });
    }

    res.json({
      message: 'OTP sent successfully to your DSU email.'
    });
  } catch (error) {
    console.error('Signup error:', error);

    res.status(500).json({
      message: 'Signup failed. Please try again.'
    });
  }
});

// VERIFY OTP AND CREATE STUDENT
app.post('/api/auth/verify-otp', async (req, res) => {
  let connection;

  try {
    const email = String(req.body.email || '').trim().toLowerCase();
    const otp = String(req.body.otp || '').trim();

    if (!isUniversityEmail(email) || !/^\d{6}$/.test(otp)) {
      return res.status(400).json({
        message: 'Enter a valid DSU email and 6-digit OTP.'
      });
    }

    connection = await pool.getConnection();
    await connection.beginTransaction();

    const [pending] = await connection.query(
      'SELECT * FROM pending_signups WHERE email = ? FOR UPDATE',
      [email]
    );

    if (!pending.length) {
      await connection.rollback();

      return res.status(400).json({
        message: 'No pending signup found. Please sign up again.'
      });
    }

    const signup = pending[0];

    if (new Date(signup.expires_at).getTime() < Date.now()) {
      await connection.query(
        'DELETE FROM pending_signups WHERE email = ?',
        [email]
      );

      await connection.commit();

      return res.status(400).json({
        message: 'OTP expired. Please sign up again.'
      });
    }

    if (hashOtp(otp) !== signup.otp_hash) {
      await connection.rollback();

      return res.status(400).json({
        message: 'Incorrect OTP.'
      });
    }

    const [existing] = await connection.query(
      'SELECT id FROM users WHERE email = ?',
      [email]
    );

    if (existing.length) {
      await connection.query(
        'DELETE FROM pending_signups WHERE email = ?',
        [email]
      );

      await connection.commit();

      return res.status(409).json({
        message: 'Account already exists. Please login.'
      });
    }

    const [result] = await connection.query(
      `INSERT INTO users
       (name, email, password_hash, role, is_verified)
       VALUES (?, ?, ?, 'student', 1)`,
      [signup.name, signup.email, signup.password_hash]
    );

    await connection.query(
      'DELETE FROM pending_signups WHERE email = ?',
      [email]
    );

    await connection.commit();

    const user = {
      id: result.insertId,
      name: signup.name,
      email: signup.email,
      role: 'student'
    };

    res.status(201).json({
      message: 'Email verified and account created.',
      token: createToken(user),
      user: publicUser(user)
    });
  } catch (error) {
    if (connection) await connection.rollback();

    console.error('OTP verification error:', error);

    res.status(500).json({
      message: 'OTP verification failed.'
    });
  } finally {
    if (connection) connection.release();
  }
});

// LOGIN
app.post('/api/auth/login', async (req, res) => {
  try {
    const email = String(req.body.email || '').trim().toLowerCase();
    const password = String(req.body.password || '');

    if (!email || !password) {
      return res.status(400).json({
        message: 'Email and password are required.'
      });
    }

    const [rows] = await pool.query(
      `SELECT id, name, email, password_hash, role, is_verified
       FROM users WHERE email = ?`,
      [email]
    );

    if (!rows.length) {
      return res.status(401).json({
        message: 'Invalid email or password.'
      });
    }

    const user = rows[0];

    if (user.role === 'student' && !isUniversityEmail(email)) {
      return res.status(403).json({
        message: 'Students must use their DSU email.'
      });
    }

    if (!['student', 'admin'].includes(user.role)) {
      return res.status(403).json({
        message: 'Invalid account role.'
      });
    }

    if (!user.is_verified) {
      return res.status(403).json({
        message: 'Please verify your email first.'
      });
    }

    const passwordMatches = await bcrypt.compare(
      password,
      user.password_hash
    );

    if (!passwordMatches) {
      return res.status(401).json({
        message: 'Invalid email or password.'
      });
    }

    res.json({
      message: 'Login successful.',
      token: createToken(user),
      user: publicUser(user)
    });
  } catch (error) {
    console.error('Login error:', error);

    res.status(500).json({
      message: 'Login failed.'
    });
  }
});

// CURRENT USER
app.get('/api/auth/me', authenticate, (req, res) => {
  res.json({
    user: publicUser(req.user)
  });
});

// GET POLLS
app.get('/api/polls', authenticate, async (req, res) => {
  try {
    const [pollRows] = await pool.query(
      `SELECT p.id, p.question, p.created_by, p.created_at,
       EXISTS(
         SELECT 1 FROM votes v
         WHERE v.poll_id = p.id AND v.user_id = ?
       ) AS voted
       FROM polls p
       ORDER BY p.created_at DESC`,
      [req.user.id]
    );

    const [optionRows] = await pool.query(
      `SELECT po.id, po.poll_id, po.option_text,
       COUNT(v.id) AS votes
       FROM poll_options po
       LEFT JOIN votes v ON v.option_id = po.id
       GROUP BY po.id, po.poll_id, po.option_text
       ORDER BY po.id`
    );

    const polls = pollRows.map((poll) => {
      const options = optionRows
        .filter((option) => Number(option.poll_id) === Number(poll.id))
        .map((option) => ({
          id: option.id,
          text: option.option_text,
          votes: Number(option.votes)
        }));

      return {
        ...poll,
        voted: Boolean(poll.voted),
        options,
        totalVotes: options.reduce(
          (sum, option) => sum + option.votes,
          0
        )
      };
    });

    res.json({ polls });
  } catch (error) {
    console.error('Get polls error:', error);

    res.status(500).json({
      message: 'Could not load polls.'
    });
  }
});

// FREE DUPLICATE POLL DETECTION
app.post('/api/polls/check-duplicate', authenticate, async (req, res) => {
  try {
    const question = String(req.body.question || '').trim();

    if (question.length < 5 || question.length > 300) {
      return res.status(400).json({
        message: 'Poll question must be between 5 and 300 characters.'
      });
    }

    const [polls] = await pool.query(
      'SELECT id, question FROM polls ORDER BY created_at DESC LIMIT 100'
    );

    const matches = polls
      .map((poll) => ({
        pollId: poll.id,
        question: poll.question,
        similarity: calculateSimilarity(question, poll.question)
      }))
      .filter((poll) => poll.similarity >= 0.30)
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, 3)
      .map((poll) => ({
        pollId: poll.pollId,
        question: poll.question,
        reason: 'This poll may cover a similar campus issue.'
      }));

    res.json({ matches });
  } catch (error) {
    console.error('Duplicate detection error:', error);

    res.status(500).json({
      message: 'Could not check similar polls.'
    });
  }
});

// CREATE POLL - STUDENTS AND ADMINS
app.post('/api/polls', authenticate, async (req, res) => {
  let connection;

  try {
    const question = String(req.body.question || '').trim();

    const options = Array.isArray(req.body.options)
      ? req.body.options
          .map((item) => String(item).trim())
          .filter(Boolean)
      : [];

    if (!question || options.length < 2) {
      return res.status(400).json({
        message: 'A question and at least two options are required.'
      });
    }

    connection = await pool.getConnection();
    await connection.beginTransaction();

    const [pollResult] = await connection.query(
      'INSERT INTO polls (question, created_by) VALUES (?, ?)',
      [question, req.user.id]
    );

    for (const option of options) {
      await connection.query(
        'INSERT INTO poll_options (poll_id, option_text) VALUES (?, ?)',
        [pollResult.insertId, option]
      );
    }

    await connection.commit();

    res.status(201).json({
      message: 'Poll created successfully.',
      pollId: pollResult.insertId
    });
  } catch (error) {
    if (connection) await connection.rollback();

    console.error('Create poll error:', error);

    res.status(500).json({
      message: 'Could not create poll.'
    });
  } finally {
    if (connection) connection.release();
  }
});

// VOTE - ONE VOTE PER USER PER POLL
app.post('/api/polls/:pollId/vote', authenticate, async (req, res) => {
  try {
    const pollId = Number(req.params.pollId);
    const optionId = Number(req.body.optionId);

    if (!Number.isInteger(pollId) || !Number.isInteger(optionId)) {
      return res.status(400).json({
        message: 'Invalid poll or option.'
      });
    }

    const [options] = await pool.query(
      'SELECT id FROM poll_options WHERE id = ? AND poll_id = ?',
      [optionId, pollId]
    );

    if (!options.length) {
      return res.status(400).json({
        message: 'Selected option does not belong to this poll.'
      });
    }

    const [existing] = await pool.query(
      'SELECT id FROM votes WHERE poll_id = ? AND user_id = ?',
      [pollId, req.user.id]
    );

    if (existing.length) {
      return res.status(409).json({
        message: 'You have already voted in this poll.'
      });
    }

    await pool.query(
      'INSERT INTO votes (poll_id, option_id, user_id) VALUES (?, ?, ?)',
      [pollId, optionId, req.user.id]
    );

    res.status(201).json({
      message: 'Vote submitted successfully.'
    });
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({
        message: 'You have already voted in this poll.'
      });
    }

    console.error('Vote error:', error);

    res.status(500).json({
      message: 'Could not submit vote.'
    });
  }
});

// SUBMIT FEEDBACK
app.post('/api/feedback', authenticate, async (req, res) => {
  try {
    const message = String(req.body.message || '').trim();

    if (!message) {
      return res.status(400).json({
        message: 'Feedback message is required.'
      });
    }

    await pool.query(
      'INSERT INTO feedback (user_id, message) VALUES (?, ?)',
      [req.user.id, message]
    );

    res.status(201).json({
      message: 'Feedback submitted successfully.'
    });
  } catch (error) {
    console.error('Feedback error:', error);

    res.status(500).json({
      message: 'Could not submit feedback.'
    });
  }
});

// ADMIN VIEW FEEDBACK
app.get('/api/feedback', authenticate, requireAdmin, async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT f.id, f.user_id, f.message, f.created_at,
       u.name, u.email
       FROM feedback f
       JOIN users u ON u.id = f.user_id
       ORDER BY f.created_at DESC`
    );

    res.json({ feedback: rows });
  } catch (error) {
    console.error('Get feedback error:', error);

    res.status(500).json({
      message: 'Could not load feedback.'
    });
  }
});

// GET MANAGEMENT UPDATES
app.get('/api/management-updates', authenticate, async (req, res) => {
  try {
    const [updates] = await pool.query(
      `SELECT mu.id, mu.poll_id, mu.admin_id,
       mu.update_message, mu.created_at,
       u.name AS admin_name,
       p.question AS poll_question
       FROM management_updates mu
       JOIN users u ON mu.admin_id = u.id
       JOIN polls p ON mu.poll_id = p.id
       ORDER BY mu.created_at DESC`
    );

    res.json({ updates });
  } catch (error) {
    console.error('Get management updates error:', error);

    res.status(500).json({
      message: 'Could not load management updates.'
    });
  }
});

// POST MANAGEMENT UPDATE - ADMIN ONLY
app.post(
  '/api/management-updates',
  authenticate,
  requireAdmin,
  async (req, res) => {
    try {
      const pollId = Number(req.body.pollId);
      const message = String(req.body.message || '').trim();

      if (!Number.isInteger(pollId) || pollId <= 0 || !message) {
        return res.status(400).json({
          message: 'Select a poll and enter an update.'
        });
      }

      const [polls] = await pool.query(
        'SELECT id FROM polls WHERE id = ?',
        [pollId]
      );

      if (!polls.length) {
        return res.status(404).json({
          message: 'Poll not found.'
        });
      }

      await pool.query(
        `INSERT INTO management_updates
         (poll_id, admin_id, update_message)
         VALUES (?, ?, ?)`,
        [pollId, req.user.id, message]
      );

      res.status(201).json({
        message: 'Management update posted successfully.'
      });
    } catch (error) {
      console.error('Post management update error:', error);

      res.status(500).json({
        message: 'Could not post management update.'
      });
    }
  }
);

// LOCAL CAMPUSVOICE CHATBOT
app.post('/api/chat', authenticate, async (req, res) => {
  try {
    const message = String(req.body.message || '').trim();

    if (!message || message.length > 1000) {
      return res.status(400).json({
        message: 'Enter a message of up to 1000 characters.'
      });
    }

    const lowerMessage = message.toLowerCase();

    const [polls] = await pool.query(
      `SELECT p.id, p.question,
       COUNT(v.id) AS total_votes
       FROM polls p
       LEFT JOIN votes v ON v.poll_id = p.id
       GROUP BY p.id, p.question
       ORDER BY total_votes DESC, p.id DESC
       LIMIT 30`
    );

    const [updates] = await pool.query(
      `SELECT p.question AS poll_question,
       mu.update_message, mu.created_at
       FROM management_updates mu
       JOIN polls p ON p.id = mu.poll_id
       ORDER BY mu.created_at DESC
       LIMIT 20`
    );

    let reply = '';

    if (
      lowerMessage.includes('hello') ||
      lowerMessage.includes('hi') ||
      lowerMessage.includes('hey')
    ) {
      reply = `Hello ${req.user.name}! Welcome to CampusVoice. You can ask me about polls, voting, feedback and management updates.`;
    } else if (
      lowerMessage.includes('trending') ||
      lowerMessage.includes('popular') ||
      lowerMessage.includes('most votes')
    ) {
      if (!polls.length) {
        reply = 'There are no campus polls available yet.';
      } else {
        reply = 'Here are the current popular campus polls:\n\n' +
          polls.slice(0, 5).map((poll, index) =>
            `${index + 1}. ${poll.question} — ${poll.total_votes} votes`
          ).join('\n');
      }
    } else if (
      lowerMessage.includes('update') ||
      lowerMessage.includes('management') ||
      lowerMessage.includes('official')
    ) {
      if (!updates.length) {
        reply = 'There are no official management updates available yet.';
      } else {
        reply = 'Latest management updates:\n\n' +
          updates.slice(0, 5).map((update, index) =>
            `${index + 1}. ${update.poll_question}\nUpdate: ${update.update_message}`
          ).join('\n\n');
      }
    } else if (
      lowerMessage.includes('vote') ||
      lowerMessage.includes('voting')
    ) {
      reply = 'To vote, open the Polls section, select your preferred option and submit your vote. You can vote only once in each poll.';
    } else if (
      lowerMessage.includes('feedback')
    ) {
      reply = 'To submit feedback, open the Feedback section, write your message and submit it. Your feedback will be available to the admin.';
    } else if (
      lowerMessage.includes('create poll') ||
      lowerMessage.includes('new poll')
    ) {
      reply = 'To create a poll, open Create Poll, enter your question and at least two options, then select Check & Create Poll.';
    } else {
      const searchWords = normalizeQuestion(message);

      const relevantPolls = polls.filter((poll) =>
        calculateSimilarity(
          searchWords.join(' '),
          poll.question
        ) >= 0.15
      );

      if (relevantPolls.length) {
        reply = 'I found these related campus polls:\n\n' +
          relevantPolls.slice(0, 5).map((poll, index) =>
            `${index + 1}. ${poll.question} — ${poll.total_votes} votes`
          ).join('\n');
      } else {
        reply = 'I can help you with CampusVoice polls, voting, feedback, trending issues and official management updates. Please try asking about one of these topics.';
      }
    }

    res.json({ reply });
  } catch (error) {
    console.error('Chatbot error:', error);

    res.status(500).json({
      message: 'Chatbot could not respond. Please try again.'
    });
  }
});

// ERROR HANDLER
app.use((error, req, res, next) => {
  console.error('Unhandled server error:', error);

  res.status(500).json({
    message: 'Internal server error.'
  });
});

// START SERVER
async function startServer() {
  try {
    if (!process.env.JWT_SECRET) {
      throw new Error('JWT_SECRET is missing in backend/.env');
    }

    await pool.query('SELECT 1');

    console.log('MySQL connection successful.');
    console.log('Free local duplicate detection enabled.');
    console.log('Local CampusVoice chatbot enabled.');

    app.listen(PORT, () => {
      console.log(`CampusVoice running on port ${PORT}`);
    });
  } catch (error) {
    console.error('Server startup failed:', error.message);
    process.exit(1);
  }
}

startServer();
