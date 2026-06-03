const { Server } = require('@modelcontextprotocol/sdk/server/index.js');
const { SSEServerTransport } = require('@modelcontextprotocol/sdk/server/sse.js');
const { ListToolsRequestSchema, CallToolRequestSchema } = require('@modelcontextprotocol/sdk/types.js');
const shopify = require('./shopify.js');
const { requireAuth } = require('./oauth.js');

const TOOLS = [
  {
    name: 'get_active_theme',
    description: 'Get the currently active Shopify theme (id, name, role)',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'get_theme_sections',
    description: 'List all section files in the active theme',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'get_theme_section',
    description: 'Read the full content of a specific theme section file',
    inputSchema: {
      type: 'object',
      properties: {
        section_key: {
          type: 'string',
          description: 'Asset key of the section, e.g. "sections/header.liquid"'
        }
      },
      required: ['section_key']
    }
  },
  {
    name: 'write_theme_section',
    description: 'Overwrite a theme section file with new content',
    inputSchema: {
      type: 'object',
      properties: {
        section_key: {
          type: 'string',
          description: 'Asset key of the section, e.g. "sections/header.liquid"'
        },
        content: {
          type: 'string',
          description: 'Full file content to write (Liquid or JSON)'
        }
      },
      required: ['section_key', 'content']
    }
  },
  {
    name: 'duplicate_product',
    description: 'Duplicate a product from a template product ID',
    inputSchema: {
      type: 'object',
      properties: {
        product_id: {
          type: 'string',
          description: 'Numeric product ID or Shopify GID of the template product'
        },
        new_title: {
          type: 'string',
          description: 'Title for the duplicated product'
        }
      },
      required: ['product_id', 'new_title']
    }
  },
  {
    name: 'create_product',
    description: 'Create a new product with DRAFT status',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        description_html: { type: 'string', description: 'HTML product description' },
        price: { type: 'number', description: 'Default price in store currency' },
        variants: {
          type: 'array',
          description: 'Optional variants. If omitted, one default variant is created.',
          items: {
            type: 'object',
            properties: {
              title: { type: 'string' },
              price: { type: 'number' }
            }
          }
        }
      },
      required: ['title', 'price']
    }
  },
  {
    name: 'set_product_draft',
    description: 'Set an existing product status to DRAFT',
    inputSchema: {
      type: 'object',
      properties: {
        product_id: {
          type: 'string',
          description: 'Numeric product ID or Shopify GID'
        }
      },
      required: ['product_id']
    }
  }
];

async function callTool(name, args) {
  switch (name) {
    case 'get_active_theme':
      return shopify.getActiveTheme();

    case 'get_theme_sections': {
      const theme = await shopify.getActiveTheme();
      return shopify.getThemeSections(theme.id);
    }

    case 'get_theme_section': {
      const theme = await shopify.getActiveTheme();
      return shopify.getThemeSection(theme.id, args.section_key);
    }

    case 'write_theme_section': {
      const theme = await shopify.getActiveTheme();
      return shopify.writeThemeSection(theme.id, args.section_key, args.content);
    }

    case 'duplicate_product':
      return shopify.duplicateProduct(args.product_id, args.new_title);

    case 'create_product':
      return shopify.createProduct({
        title: args.title,
        descriptionHtml: args.description_html || '',
        price: args.price,
        variants: args.variants || []
      });

    case 'set_product_draft':
      return shopify.setProductDraft(args.product_id);

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

function createMcpServer() {
  const server = new Server(
    { name: 'shopify-mcp', version: '1.0.0' },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    try {
      const result = await callTool(name, args || {});
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    } catch (err) {
      return {
        content: [{ type: 'text', text: `Error: ${err.message}` }],
        isError: true
      };
    }
  });

  return server;
}

function setupMcpRoutes(app) {
  const transports = {};

  app.get('/sse', requireAuth, async (req, res) => {
    const transport = new SSEServerTransport('/messages', res);
    transports[transport.sessionId] = transport;
    res.on('close', () => delete transports[transport.sessionId]);
    const server = createMcpServer();
    await server.connect(transport);
  });

  app.post('/messages', requireAuth, async (req, res) => {
    const transport = transports[req.query.sessionId];
    if (!transport) return res.status(400).json({ error: 'Session not found' });
    await transport.handlePostMessage(req, res, req.body);
  });
}

module.exports = { setupMcpRoutes };
