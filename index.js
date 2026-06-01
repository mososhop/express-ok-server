const express = require('express');
const { setupMcpRoutes } = require('./mcp.js');

const app = express();
const port = process.env.PORT || 3000;

app.use(express.json());

app.get('/', (req, res) => res.send('OK'));

setupMcpRoutes(app);

app.listen(port, () => console.log(`Server running on port ${port}`));
