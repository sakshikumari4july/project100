
import { useEffect, useState } from 'react';
import './App.css';

const API = import.meta.env.VITE_API_URL || 'http://localhost:5001';

async function apiRequest(path, options = {}, token = '') {
  const response = await fetch(`${API}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data.message || 'Something went wrong.');
  }

  return data;
}

export default function App() {
  const [page, setPage] = useState('home');
  const [authMode, setAuthMode] = useState('login');
  const [user, setUser] = useState(null);
  const [token, setToken] = useState(localStorage.getItem('cv_token') || '');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [otp, setOtp] = useState('');
  const [otpSent, setOtpSent] = useState(false);

  const [polls, setPolls] = useState([]);
  const [feedback, setFeedback] = useState([]);
  const [feedbackMessage, setFeedbackMessage] = useState('');

  const [question, setQuestion] = useState('');
  const [options, setOptions] = useState(['', '']);

  // AI duplicate detection
  const [duplicateMatches, setDuplicateMatches] = useState([]);
  const [pendingPoll, setPendingPoll] = useState(null);
  const [checkingDuplicates, setCheckingDuplicates] = useState(false);

  const [managementUpdates, setManagementUpdates] = useState([]);
  const [selectedPollId, setSelectedPollId] = useState('');
  const [updateMessage, setUpdateMessage] = useState('');

  // AI chatbot
  const [chatMessages, setChatMessages] = useState([]);
  const [chatInput, setChatInput] = useState('');
  const [chatLoading, setChatLoading] = useState(false);

  const isAdmin = user?.role === 'admin';

  function notify(text, isError = false) {
    setMessage(isError ? '' : text);
    setError(isError ? text : '');
  }

  function clearMessages() {
    setMessage('');
    setError('');
  }

  function logout() {
    localStorage.removeItem('cv_token');
    setToken('');
    setUser(null);
    setPage('home');
    setOtpSent(false);
    setPolls([]);
    setFeedback([]);
    setManagementUpdates([]);
    setChatMessages([]);
    clearMessages();
  }

  function finishLogin(data) {
    localStorage.setItem('cv_token', data.token);
    setToken(data.token);
    setUser(data.user);
    setPage('dashboard');
    setOtpSent(false);
    setPassword('');
    setOtp('');
    notify('Welcome to CampusVoice!');
  }

  useEffect(() => {
    if (!token) return;

    apiRequest('/api/auth/me', {}, token)
      .then((data) => {
        setUser(data.user);
        setPage('dashboard');
      })
      .catch(() => {
        localStorage.removeItem('cv_token');
        setToken('');
        setUser(null);
      });
  }, []);

  useEffect(() => {
    if (token && user) {
      loadPolls();
      loadManagementUpdates();

      if (user.role === 'admin') {
        loadFeedback();
      }
    }
  }, [token, user]);

  async function handleSignup(event) {
    event.preventDefault();
    clearMessages();

    try {
      setLoading(true);
      const data = await apiRequest('/api/auth/signup', {
        method: 'POST',
        body: JSON.stringify({ name, email, password }),
      });

      setOtpSent(true);
      notify(data.message || 'OTP sent to your DSU email.');
    } catch (err) {
      notify(err.message, true);
    } finally {
      setLoading(false);
    }
  }

  async function handleVerifyOtp(event) {
    event.preventDefault();
    clearMessages();

    try {
      setLoading(true);
      const data = await apiRequest('/api/auth/verify-otp', {
        method: 'POST',
        body: JSON.stringify({ email, otp }),
      });

      finishLogin(data);
    } catch (err) {
      notify(err.message, true);
    } finally {
      setLoading(false);
    }
  }

  async function handleLogin(event) {
    event.preventDefault();
    clearMessages();

    try {
      setLoading(true);
      const data = await apiRequest('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      });

      finishLogin(data);
    } catch (err) {
      notify(err.message, true);
    } finally {
      setLoading(false);
    }
  }

  async function loadPolls() {
    try {
      const data = await apiRequest('/api/polls', {}, token);
      setPolls(data.polls || []);
    } catch (err) {
      notify(err.message, true);
    }
  }

  async function loadFeedback() {
    try {
      const data = await apiRequest('/api/feedback', {}, token);
      setFeedback(data.feedback || []);
    } catch (err) {
      notify(err.message, true);
    }
  }

  async function loadManagementUpdates() {
    try {
      const data = await apiRequest('/api/management-updates', {}, token);
      setManagementUpdates(data.updates || []);
    } catch (err) {
      notify(err.message, true);
    }
  }

  async function submitVote(pollId, optionId) {
    clearMessages();

    try {
      await apiRequest(`/api/polls/${pollId}/vote`, {
        method: 'POST',
        body: JSON.stringify({ optionId }),
      }, token);

      notify('Your vote has been submitted successfully.');
      await loadPolls();
    } catch (err) {
      notify(err.message, true);
    }
  }

  async function submitFeedback(event) {
    event.preventDefault();
    clearMessages();

    try {
      await apiRequest('/api/feedback', {
        method: 'POST',
        body: JSON.stringify({ message: feedbackMessage }),
      }, token);

      setFeedbackMessage('');
      notify('Feedback submitted successfully.');
    } catch (err) {
      notify(err.message, true);
    }
  }

  // Create a poll after duplicate check or user confirmation
  async function savePoll(pollData) {
    try {
      setLoading(true);

      await apiRequest('/api/polls', {
        method: 'POST',
        body: JSON.stringify(pollData),
      }, token);

      setQuestion('');
      setOptions(['', '']);
      setPendingPoll(null);
      setDuplicateMatches([]);
      notify('Poll created successfully!');

      await loadPolls();
      setPage('polls');
    } catch (err) {
      notify(err.message, true);
    } finally {
      setLoading(false);
    }
  }

  // AI checks whether a similar poll already exists
  async function createPoll(event) {
    event.preventDefault();
    clearMessages();

    const pollQuestion = question.trim();
    const validOptions = options
      .map((item) => item.trim())
      .filter(Boolean);

    if (pollQuestion.length < 5) {
      notify('Please enter a longer poll question.', true);
      return;
    }

    if (validOptions.length < 2) {
      notify('Please enter at least two poll options.', true);
      return;
    }

    const pollData = {
      question: pollQuestion,
      options: validOptions,
    };

    try {
      setCheckingDuplicates(true);

      const data = await apiRequest('/api/polls/check-duplicate', {
        method: 'POST',
        body: JSON.stringify({ question: pollQuestion }),
      }, token);

      if (data.matches?.length > 0) {
        setPendingPoll(pollData);
        setDuplicateMatches(data.matches);
        return;
      }

      await savePoll(pollData);
    } catch (err) {
      notify(err.message, true);
    } finally {
      setCheckingDuplicates(false);
    }
  }

  async function postManagementUpdate(event) {
    event.preventDefault();
    clearMessages();

    if (!selectedPollId || !updateMessage.trim()) {
      notify('Please select a poll and enter an update.', true);
      return;
    }

    try {
      setLoading(true);

      const data = await apiRequest('/api/management-updates', {
        method: 'POST',
        body: JSON.stringify({
          pollId: Number(selectedPollId),
          message: updateMessage.trim(),
        }),
      }, token);

      setUpdateMessage('');
      notify(data.message || 'Management update posted successfully.');
      await loadManagementUpdates();
    } catch (err) {
      notify(err.message, true);
    } finally {
      setLoading(false);
    }
  }

  // AI chatbot message handler
  async function sendChatMessage(event) {
    event.preventDefault();

    const text = chatInput.trim();
    if (!text || chatLoading) return;

    clearMessages();

    const previousMessages = chatMessages;
    setChatMessages((previous) => [
      ...previous,
      { role: 'user', content: text },
    ]);
    setChatInput('');

    try {
      setChatLoading(true);

      const data = await apiRequest('/api/chat', {
        method: 'POST',
        body: JSON.stringify({
          message: text,
          history: previousMessages.slice(-8),
        }),
      }, token);

      setChatMessages((previous) => [
        ...previous,
        {
          role: 'assistant',
          content: data.reply || 'Sorry, I could not respond.',
        },
      ]);
    } catch (err) {
      setChatMessages((previous) => [
        ...previous,
        {
          role: 'assistant',
          content: `Sorry, something went wrong: ${err.message}`,
        },
      ]);
    } finally {
      setChatLoading(false);
    }
  }

  function openUpdates() {
    clearMessages();
    setPage('updates');
    loadManagementUpdates();

    if (isAdmin) loadPolls();
  }

  function updateOption(index, value) {
    setOptions((previous) =>
      previous.map((item, i) => i === index ? value : item)
    );
  }

  function addOption() {
    if (options.length < 6) {
      setOptions((previous) => [...previous, '']);
    }
  }

  function removeOption(index) {
    if (options.length > 2) {
      setOptions((previous) =>
        previous.filter((_, i) => i !== index)
      );
    }
  }

  const trendingPolls = [...polls]
    .sort((a, b) => Number(b.totalVotes) - Number(a.totalVotes))
    .slice(0, 5);

  const navigation = [
    { id: 'dashboard', label: 'Dashboard' },
    { id: 'polls', label: 'Polls' },
    { id: 'create-poll', label: 'Create Poll' },
    { id: 'updates', label: 'Management Updates' },
    { id: 'feedback', label: 'Feedback' },
    { id: 'chat', label: 'AI Assistant' },
    ...(isAdmin ? [{ id: 'admin', label: 'Admin Panel' }] : []),
  ];

  return (
    <div className="app-container">
      <header className="main-header">
        <div
          className="brand"
          onClick={() => setPage(user ? 'dashboard' : 'home')}
        >
          <span className="brand-icon">CV</span>
          <div>
            <h2>CampusVoice</h2>
            <small>Every Voice Matters</small>
          </div>
        </div>

        <nav className="main-nav">
          {user ? (
            <>
              {navigation.map((item) => (
                <button
                  key={item.id}
                  className={page === item.id ? 'nav-link active' : 'nav-link'}
                  onClick={() => {
                    clearMessages();
                    setPage(item.id);

                    if (item.id === 'polls') loadPolls();
                    if (item.id === 'admin') loadFeedback();
                    if (item.id === 'updates') openUpdates();
                  }}
                >
                  {item.label}
                </button>
              ))}

              <button className="nav-button" onClick={logout}>
                Logout
              </button>
            </>
          ) : (
            <>
              <button className="nav-link" onClick={() => setPage('home')}>
                Home
              </button>
              <button
                className="nav-button"
                onClick={() => {
                  setAuthMode('login');
                  setPage('auth');
                }}
              >
                Login
              </button>
            </>
          )}
        </nav>
      </header>

      {(message || error) && (
        <div className={error ? 'alert error' : 'alert success'}>
          {error || message}
          <button onClick={clearMessages}>×</button>
        </div>
      )}

      <main className="main-content">
        {!user && page === 'home' && (
          <section className="hero-section">
            <div className="hero-content">
              <span className="eyebrow">YOUR CAMPUS. YOUR VOICE.</span>
              <h1>Make Your Voice <span>Count.</span></h1>
              <p>
                CampusVoice is a student feedback platform where every opinion
                matters. Participate in polls and help improve campus life.
              </p>

              <div className="hero-actions">
                <button
                  className="primary-button"
                  onClick={() => {
                    setAuthMode('signup');
                    setPage('auth');
                  }}
                >
                  Get Started
                </button>
                <button
                  className="secondary-button"
                  onClick={() => {
                    setAuthMode('login');
                    setPage('auth');
                  }}
                >
                  Login
                </button>
              </div>
            </div>

            <div className="hero-visual">
              <div className="hero-card">
                <div className="hero-card-icon">💬</div>
                <h3>Student Voices</h3>
                <p>Share ideas. Give feedback. Make a difference.</p>
              </div>
            </div>
          </section>
        )}

        {!user && page === 'auth' && (
          <section className="auth-section">
            <div className="auth-card">
              <h1>
                {otpSent
                  ? 'Verify Your Email'
                  : authMode === 'signup'
                    ? 'Create Account'
                    : 'Welcome Back'}
              </h1>

              <p>
                {otpSent
                  ? 'Enter the 6-digit OTP sent to your DSU email.'
                  : authMode === 'signup'
                    ? 'Register using your university email.'
                    : 'Login to continue to CampusVoice.'}
              </p>

              {!otpSent && (
                <div className="auth-tabs">
                  <button
                    className={authMode === 'login' ? 'tab active' : 'tab'}
                    onClick={() => {
                      setAuthMode('login');
                      clearMessages();
                    }}
                  >
                    Login
                  </button>
                  <button
                    className={authMode === 'signup' ? 'tab active' : 'tab'}
                    onClick={() => {
                      setAuthMode('signup');
                      clearMessages();
                    }}
                  >
                    Sign Up
                  </button>
                </div>
              )}

              {otpSent ? (
                <form onSubmit={handleVerifyOtp}>
                  <label>University Email</label>
                  <input value={email} readOnly />
                  <label>6-digit OTP</label>
                  <input
                    value={otp}
                    onChange={(e) =>
                      setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))
                    }
                    placeholder="Enter OTP"
                    inputMode="numeric"
                    required
                  />
                  <button className="primary-button full-button" disabled={loading}>
                    {loading ? 'Verifying...' : 'Verify OTP'}
                  </button>
                  <button
                    type="button"
                    className="text-button"
                    onClick={() => {
                      setOtpSent(false);
                      setOtp('');
                    }}
                  >
                    Back to signup
                  </button>
                </form>
              ) : authMode === 'signup' ? (
                <form onSubmit={handleSignup}>
                  <label>Full Name</label>
                  <input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Enter your full name"
                    required
                  />
                  <label>DSU University Email</label>
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="name@dsu.edu.in"
                    required
                  />
                  <label>Password</label>
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Minimum 8 characters"
                    minLength={8}
                    required
                  />
                  <button className="primary-button full-button" disabled={loading}>
                    {loading ? 'Sending OTP...' : 'Send OTP'}
                  </button>
                </form>
              ) : (
                <form onSubmit={handleLogin}>
                  <label>Email Address</label>
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="DSU email or admin Gmail"
                    required
                  />
                  <label>Password</label>
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Enter your password"
                    required
                  />
                  <button className="primary-button full-button" disabled={loading}>
                    {loading ? 'Logging in...' : 'Login'}
                  </button>
                </form>
              )}

              <button
                className="text-button"
                onClick={() => {
                  setPage('home');
                  setOtpSent(false);
                  clearMessages();
                }}
              >
                Back to Home
              </button>
            </div>
          </section>
        )}

        {user && page === 'dashboard' && (
          <section className="dashboard-section">
            <div className="welcome-banner">
              <span className="eyebrow">CAMPUSVOICE DASHBOARD</span>
              <h1>Welcome, {user.name}!</h1>
              <p>
                {isAdmin
                  ? 'Manage campus polls and review student feedback.'
                  : 'Your voice matters. Participate and make a difference.'}
              </p>
            </div>

            <div className="stats-grid">
              <div className="stat-card">
                <span>Available Polls</span>
                <h2>{polls.length}</h2>
              </div>
              <div className="stat-card">
                <span>Your Completed Votes</span>
                <h2>{polls.filter((poll) => poll.voted).length}</h2>
              </div>
              {isAdmin && (
                <div className="stat-card">
                  <span>Feedback Entries</span>
                  <h2>{feedback.length}</h2>
                </div>
              )}
            </div>

            <div className="dashboard-actions">
              <button className="primary-button" onClick={() => {
                setPage('polls');
                loadPolls();
              }}>
                Explore Polls
              </button>
              <button className="secondary-button" onClick={() => setPage('create-poll')}>
                Create Poll
              </button>
              <button className="secondary-button" onClick={() => setPage('feedback')}>
                Give Feedback
              </button>
              <button className="secondary-button" onClick={openUpdates}>
                Management Updates
              </button>
              <button className="secondary-button" onClick={() => setPage('chat')}>
                Ask AI Assistant
              </button>
              {isAdmin && (
                <button className="secondary-button" onClick={() => setPage('admin')}>
                  Open Admin Panel
                </button>
              )}
            </div>

            <div className="trending-section">
              <div className="section-heading">
                <span className="eyebrow">MOST PARTICIPATED</span>
                <h2>Trending Issues</h2>
                <p>Campus polls receiving the most votes.</p>
              </div>

              {trendingPolls.length === 0 ? (
                <p className="empty-state">No trending issues yet.</p>
              ) : (
                <div className="poll-grid">
                  {trendingPolls.map((poll) => (
                    <article className="poll-card" key={poll.id}>
                      <h3>{poll.question}</h3>
                      <p>{poll.totalVotes} total votes</p>
                      <button className="text-button" onClick={() => setPage('polls')}>
                        View Poll
                      </button>
                    </article>
                  ))}
                </div>
              )}
            </div>
          </section>
        )}

        {user && page === 'polls' && (
          <section className="content-section">
            <div className="section-heading">
              <span className="eyebrow">CAMPUS POLLS</span>
              <h1>Explore Polls</h1>
              <p>Share your opinion by participating in campus polls.</p>
              <button className="secondary-button" onClick={loadPolls}>
                Refresh Polls
              </button>
            </div>

            {polls.length === 0 ? (
              <p className="empty-state">No polls available right now.</p>
            ) : (
              <div className="poll-grid">
                {polls.map((poll) => (
                  <article className="poll-card" key={poll.id}>
                    <h3>{poll.question}</h3>
                    <p>{poll.totalVotes} total votes</p>
                    {poll.options.map((option) => {
                      const percentage = poll.totalVotes
                        ? Math.round((option.votes / poll.totalVotes) * 100)
                        : 0;

                      return (
                        <div className="poll-option" key={option.id}>
                          <button
                            disabled={poll.voted}
                            onClick={() => submitVote(poll.id, option.id)}
                          >
                            {option.text}
                            {poll.voted && <span>{percentage}%</span>}
                          </button>
                          {poll.voted && (
                            <div className="progress-track">
                              <div
                                className="progress-fill"
                                style={{ width: `${percentage}%` }}
                              />
                            </div>
                          )}
                        </div>
                      );
                    })}
                    <p className="poll-status">
                      {poll.voted ? 'You have already voted.' : 'Select an option to vote.'}
                    </p>
                  </article>
                ))}
              </div>
            )}
          </section>
        )}

        {user && page === 'create-poll' && (
          <section className="content-section">
            <div className="section-heading">
              <span className="eyebrow">COMMUNITY PARTICIPATION</span>
              <h1>Create a Campus Poll</h1>
              <p>
                Share an issue or question with the campus community.
                Everyone can participate.
              </p>
            </div>

            <form className="admin-form" onSubmit={createPoll}>
              <h2>New Poll</h2>
              <label>Poll Question</label>
              <input
                value={question}
                onChange={(e) => {
                  setQuestion(e.target.value);
                  setDuplicateMatches([]);
                  setPendingPoll(null);
                }}
                placeholder="What issue would you like to discuss?"
                required
                maxLength={300}
              />

              <label>Poll Options</label>
              {options.map((option, index) => (
                <div className="option-input-row" key={index}>
                  <input
                    value={option}
                    onChange={(e) => updateOption(index, e.target.value)}
                    placeholder={`Option ${index + 1}`}
                    required
                  />
                  {options.length > 2 && (
                    <button type="button" onClick={() => removeOption(index)}>
                      ×
                    </button>
                  )}
                </div>
              ))}

              {options.length < 6 && (
                <button type="button" className="text-button" onClick={addOption}>
                  + Add Option
                </button>
              )}

              {duplicateMatches.length > 0 && (
                <div className="duplicate-warning">
                  <h3>Similar Polls Found!</h3>
                  <p>
                    Our AI found existing polls that may discuss the same issue.
                    Check them before creating another poll.
                  </p>

                  {duplicateMatches.map((match) => (
                    <div className="feedback-card" key={match.pollId}>
                      <h4>{match.question}</h4>
                      <p>{match.reason}</p>
                      <button
                        type="button"
                        className="secondary-button"
                        onClick={async () => {
                          await loadPolls();
                          setPage('polls');
                          setPendingPoll(null);
                          setDuplicateMatches([]);
                          notify('Find the matching poll below and select your vote.');
                        }}
                      >
                        View Existing Polls
                      </button>
                    </div>
                  ))}

                  <p>
                    Still want to create a separate poll?
                  </p>
                  <button
                    type="button"
                    className="primary-button"
                    disabled={loading}
                    onClick={() => savePoll(pendingPoll)}
                  >
                    Create New Poll Anyway
                  </button>
                  <button
                    type="button"
                    className="text-button"
                    onClick={() => {
                      setPendingPoll(null);
                      setDuplicateMatches([]);
                    }}
                  >
                    Cancel
                  </button>
                </div>
              )}

              {!duplicateMatches.length && (
                <button
                  className="primary-button full-button"
                  disabled={loading || checkingDuplicates}
                >
                  {checkingDuplicates
                    ? 'AI Checking Similar Polls...'
                    : loading
                      ? 'Creating Poll...'
                      : 'Check & Create Poll'}
                </button>
              )}
            </form>
          </section>
        )}

        {user && page === 'updates' && (
          <section className="content-section">
            <div className="section-heading">
              <span className="eyebrow">CAMPUS COMMUNICATION</span>
              <h1>Management Updates</h1>
              <p>Read official responses and announcements from campus management.</p>
              <button className="secondary-button" onClick={loadManagementUpdates}>
                Refresh Updates
              </button>
            </div>

            {isAdmin && (
              <form className="admin-form" onSubmit={postManagementUpdate}>
                <h2>Post Official Update</h2>
                <label>Select Related Poll</label>
                <select
                  value={selectedPollId}
                  onChange={(e) => setSelectedPollId(e.target.value)}
                  required
                >
                  <option value="">Choose a poll</option>
                  {polls.map((poll) => (
                    <option key={poll.id} value={poll.id}>
                      {poll.question}
                    </option>
                  ))}
                </select>

                <label>Management Response</label>
                <textarea
                  value={updateMessage}
                  onChange={(e) => setUpdateMessage(e.target.value)}
                  placeholder="Write the official response or update..."
                  rows={5}
                  required
                />

                <button
                  className="primary-button full-button"
                  disabled={loading || !polls.length}
                >
                  {loading ? 'Posting...' : 'Post Management Update'}
                </button>
              </form>
            )}

            <div className="feedback-list">
              <div className="feedback-list-heading">
                <h2>Official Updates</h2>
              </div>

              {managementUpdates.length === 0 ? (
                <p className="empty-state">No management updates have been posted yet.</p>
              ) : (
                managementUpdates.map((item) => (
                  <article className="feedback-card" key={item.id}>
                    <span className="eyebrow">OFFICIAL RESPONSE</span>
                    <h3>{item.poll_question}</h3>
                    <p>{item.update_message}</p>
                    <small>Posted by {item.admin_name}</small>
                    <br />
                    <small>{new Date(item.created_at).toLocaleString()}</small>
                  </article>
                ))
              )}
            </div>
          </section>
        )}

        {user && page === 'feedback' && (
          <section className="content-section">
            <div className="section-heading">
              <span className="eyebrow">YOUR OPINION MATTERS</span>
              <h1>Share Your Feedback</h1>
              <p>Help us improve the campus experience.</p>
            </div>

            <form className="feedback-form" onSubmit={submitFeedback}>
              <label>Your Feedback</label>
              <textarea
                value={feedbackMessage}
                onChange={(e) => setFeedbackMessage(e.target.value)}
                placeholder="Write your suggestions or feedback here..."
                rows={6}
                required
              />
              <button className="primary-button" disabled={!feedbackMessage.trim()}>
                Submit Feedback
              </button>
            </form>
          </section>
        )}

        {user && page === 'chat' && (
          <section className="content-section">
            <div className="section-heading">
              <span className="eyebrow">CAMPUSVOICE AI</span>
              <h1>AI Assistant</h1>
              <p>
                Ask questions about campus polls, voting and official management updates.
              </p>
            </div>

            <div className="admin-form chat-container">
              <div className="chat-messages">
                {chatMessages.length === 0 && (
                  <div className="empty-state">
                    <h3>How can I help you?</h3>
                    <p>
                      Ask me about trending campus issues, poll results or
                      management responses.
                    </p>
                  </div>
                )}

                {chatMessages.map((item, index) => (
                  <div
                    key={index}
                    className={`chat-message ${item.role === 'user' ? 'user-message' : 'assistant-message'}`}
                  >
                    <strong>
                      {item.role === 'user' ? 'You' : 'CampusVoice AI'}
                    </strong>
                    <p>{item.content}</p>
                  </div>
                ))}

                {chatLoading && (
                  <p className="empty-state">CampusVoice AI is thinking...</p>
                )}
              </div>

              <form onSubmit={sendChatMessage}>
                <label>Ask your question</label>
                <textarea
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  placeholder="Type your question here..."
                  rows={3}
                  maxLength={1000}
                  required
                />
                <button
                  className="primary-button full-button"
                  disabled={chatLoading || !chatInput.trim()}
                >
                  {chatLoading ? 'Sending...' : 'Send Message'}
                </button>
                <button
                  type="button"
                  className="text-button"
                  onClick={() => setChatMessages([])}
                >
                  Clear Chat
                </button>
              </form>
            </div>
          </section>
        )}

        {user && page === 'admin' && isAdmin && (
          <section className="content-section">
            <div className="section-heading">
              <span className="eyebrow">ADMINISTRATION</span>
              <h1>Admin Panel</h1>
              <p>Review feedback submitted by students.</p>
            </div>

            <div className="feedback-list">
              <div className="feedback-list-heading">
                <h2>Student Feedback</h2>
                <button className="text-button" onClick={loadFeedback}>
                  Refresh
                </button>
              </div>

              {feedback.length === 0 ? (
                <p className="empty-state">No feedback received yet.</p>
              ) : (
                feedback.map((item) => (
                  <article className="feedback-card" key={item.id}>
                    <h3>{item.name}</h3>
                    <small>{item.email}</small>
                    <p>{item.message}</p>
                    <small>{new Date(item.created_at).toLocaleString()}</small>
                  </article>
                ))
              )}
            </div>
          </section>
        )}
      </main>

      <footer className="main-footer">
        <h3>CampusVoice</h3>
        <p>Every Voice Matters. Together, We Make Campus Better.</p>
        <small>© {new Date().getFullYear()} CampusVoice</small>
      </footer>
    </div>
  );
}
