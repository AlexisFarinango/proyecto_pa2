const basicAuth = (req, res, next) => {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Basic ')) {
    res.setHeader('WWW-Authenticate', 'Basic realm="Admin Area"');
    return res.status(401).json({ message: 'Authentication required' });
  }
  const base64Credentials = auth.split(' ')[1];
  const creds = Buffer.from(base64Credentials, 'base64').toString('ascii');
  const [user, pass] = creds.split(':');
  const ADMIN_USER = process.env.ADMIN_USER;
  const ADMIN_PASS = process.env.ADMIN_PASS;
  if (user === ADMIN_USER && pass === ADMIN_PASS) return next();
  res.setHeader('WWW-Authenticate', 'Basic realm="Admin Area"');
  return res.status(401).json({ message: 'Invalid credentials' });
};

module.exports = basicAuth;
