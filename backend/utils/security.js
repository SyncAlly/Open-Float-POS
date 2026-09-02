function isProduction() {
  return process.env.NODE_ENV === 'production';
}

function getJwtSecret() {
  const configured = process.env.JWT_SECRET;
  const fallbackDevSecret = 'openfloat_secret_dev_only';

  if (configured && configured !== 'openfloat_secret' && configured !== 'YOUR_JWT_SECRET_HERE') {
    return configured;
  }

  if (isProduction()) {
    throw new Error('JWT_SECRET must be configured with a strong secret in production.');
  }

  return configured || fallbackDevSecret;
}

function isStrongPassword(password) {
  if (typeof password !== 'string') return false;
  if (password.length < 8) return false;
  if (!/[A-Z]/.test(password)) return false;
  if (!/[a-z]/.test(password)) return false;
  if (!/[0-9]/.test(password)) return false;
  return true;
}

function passwordPolicyError() {
  return 'Password must be at least 8 characters and include uppercase, lowercase, and a number.';
}

module.exports = {
  isProduction,
  getJwtSecret,
  isStrongPassword,
  passwordPolicyError,
};
