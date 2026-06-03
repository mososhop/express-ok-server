const express = require('express');
const { setupMcpRoutes } = require('./mcp.js');
const { setupOAuthRoutes } = require('./oauth.js');

const app = express();
const port = process.env.PORT || 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: false }));

app.get('/', (_req, res) => res.send('OK'));

setupOAuthRoutes(app);
setupMcpRoutes(app);

app.listen(port, () => console.log(`Server running on port ${port}`));
