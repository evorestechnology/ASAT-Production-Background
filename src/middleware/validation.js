// Validation middleware
const { validateEmail, validatePassword, validateUsername } = require('../validation');

const validateRegisterInput = (req, res, next) => {
  const { email, password, otp, fullName, username } = req.body;

  // Email validation
  if (!email || !validateEmail(email)) {
    return res.status(400).json({
      success: false,
      message: 'Valid email is required'
    });
  }

  // Password validation
  if (!password || !validatePassword(password)) {
    return res.status(400).json({
      success: false,
      message: 'Password must be at least 6 characters long'
    });
  }

  // OTP validation
  if (!otp || otp.length !== 6 || !/^\d+$/.test(otp)) {
    return res.status(400).json({
      success: false,
      message: 'Valid 6-digit OTP is required'
    });
  }

  // Full name validation
  if (!fullName || fullName.trim().length < 2) {
    return res.status(400).json({
      success: false,
      message: 'Full name must be at least 2 characters long'
    });
  }

  // Username validation
  if (!username || !validateUsername(username)) {
    return res.status(400).json({
      success: false,
      message: 'Username must be 3-20 characters (letters, numbers, underscore, hyphen only)'
    });
  }

  next();
};

const validateLoginInput = (req, res, next) => {
  const { email, password } = req.body;

  // Email validation
  if (!email || !validateEmail(email)) {
    return res.status(400).json({
      success: false,
      message: 'Valid email is required'
    });
  }

  // Password validation
  if (!password || !validatePassword(password)) {
    return res.status(400).json({
      success: false,
      message: 'Password must be at least 6 characters long'
    });
  }

  next();
};

const validateEmailInput = (req, res, next) => {
  const { email } = req.body;

  if (!email || !validateEmail(email)) {
    return res.status(400).json({
      success: false,
      message: 'Valid email is required'
    });
  }

  next();
};

const validateUsernameInput = (req, res, next) => {
  const { username } = req.body;

  if (!username || !validateUsername(username)) {
    return res.status(400).json({
      success: false,
      message: 'Username must be 3-20 characters (letters, numbers, underscore, hyphen only)'
    });
  }

  next();
};

module.exports = {
  validateRegisterInput,
  validateLoginInput,
  validateEmailInput,
  validateUsernameInput
};