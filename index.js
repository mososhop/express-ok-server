const express = require('express');
const { setupMcpRoutes } = require('./mcp.js');
const { setupOAuthRoutes } = require('./oauth.js');

const app = express();
const port = process.env.PORT || 3000;

console.log('Startup env check:', {
  PORT: port,
  SHOPIFY_ACCESS_TOKEN: process.env.SHOPIFY_ACCESS_TOKEN ? `SET (${process.env.SHOPIFY_ACCESS_TOKEN.length} chars)` : 'NOT SET',
  SHOPIFY_STORE: process.env.SHOPIFY_STORE || '77057e.myshopify.com (default)',
  OAUTH_SECRET: process.env.OAUTH_SECRET ? 'SET' : 'NOT SET',
  MCP_API_KEY: process.env.MCP_API_KEY ? 'SET' : 'NOT SET',
});

app.use(express.json());
app.use(express.urlencoded({ extended: false }));

app.get('/', (_req, res) => res.send('OK'));

setupOAuthRoutes(app);
setupMcpRoutes(app);

app.listen(port, () => console.log(`Server running on port ${port}`));
