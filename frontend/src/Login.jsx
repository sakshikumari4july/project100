
import { useState } from 'react'
import universityLogo from './dsu-logo.jpeg'
import './Login.css'

function Login({ onBack, initialSignup = false }) {
  const [isSignup, setIsSignup] = useState(initialSignup)

  const [formData, setFormData] = useState({
    name: '',
    email: '',
    password: ''
  })

  const handleChange = (e) => {
    setFormData({
      ...formData,
      [e.target.name]: e.target.value
    })
  }

  const handleSubmit = (e) => {
    e.preventDefault()

    alert(
      isSignup
        ? 'Signup form submitted!'
        : 'Login form submitted!'
    )
  }

  return (
    <div className="auth-page">

      <div className="auth-card">

        {/* Back to Home Button */}
        <button
          type="button"
          onClick={onBack}
          style={{
            display: 'block',
            marginBottom: '20px',
            background: 'transparent',
            border: 'none',
            color: '#1765bd',
            fontSize: '15px',
            fontWeight: '600',
            cursor: 'pointer'
          }}
        >
          ← Back to Home
        </button>

        <img
          src={universityLogo}
          alt="DSU Logo"
          className="auth-logo"
        />

        <h1>CampusVoice</h1>

        <p className="auth-subtitle">
          Your Voice. Your Campus. Your Community.
        </p>

        <div className="auth-tabs">
          <button
            type="button"
            className={!isSignup ? 'active' : ''}
            onClick={() => setIsSignup(false)}
          >
            Login
          </button>

          <button
            type="button"
            className={isSignup ? 'active' : ''}
            onClick={() => setIsSignup(true)}
          >
            Sign Up
          </button>
        </div>

        <h2>
          {isSignup ? 'Create Your Account' : 'Welcome Back!'}
        </h2>

        <p className="auth-description">
          {isSignup
            ? 'Join your university community today.'
            : 'Login to access your student community.'}
        </p>

        <form onSubmit={handleSubmit}>

          {isSignup && (
            <div className="form-group">
              <label>Full Name</label>
              <input
                type="text"
                name="name"
                placeholder="Enter your full name"
                value={formData.name}
                onChange={handleChange}
                required
              />
            </div>
          )}

          <div className="form-group">
            <label>University Email</label>
            <input
              type="email"
              name="email"
              placeholder="Enter your email"
              value={formData.email}
              onChange={handleChange}
              required
            />
          </div>

          <div className="form-group">
            <label>Password</label>
            <input
              type="password"
              name="password"
              placeholder="Enter your password"
              value={formData.password}
              onChange={handleChange}
              required
              minLength={6}
            />
          </div>

          <button type="submit" className="auth-submit">
            {isSignup ? 'Create Account' : 'Login to CampusVoice'}
          </button>

        </form>

        <p className="auth-switch">
          {isSignup
            ? 'Already have an account?'
            : "Don't have an account?"}

          <button
            type="button"
            onClick={() => setIsSignup(!isSignup)}
          >
            {isSignup ? ' Login' : ' Sign Up'}
          </button>
        </p>

        <p className="auth-footer">
          Dayananda Sagar University, Bangalore
        </p>

      </div>

    </div>
  )
}

export default Login
