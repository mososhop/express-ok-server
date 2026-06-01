const STORE = process.env.SHOPIFY_STORE || 'mososhop.myshopify.com';
const TOKEN = process.env.SHOPIFY_ACCESS_TOKEN;
const API_VERSION = '2024-01';

const REST_BASE = `https://${STORE}/admin/api/${API_VERSION}`;
const GQL_URL = `https://${STORE}/admin/api/${API_VERSION}/graphql.json`;

function authHeaders() {
  if (!TOKEN) throw new Error('SHOPIFY_ACCESS_TOKEN is not set');
  return { 'X-Shopify-Access-Token': TOKEN, 'Content-Type': 'application/json' };
}

async function restGet(path) {
  const res = await fetch(`${REST_BASE}${path}`, { headers: authHeaders() });
  if (!res.ok) throw new Error(`Shopify REST ${res.status}: ${await res.text()}`);
  return res.json();
}

async function restPut(path, body) {
  const res = await fetch(`${REST_BASE}${path}`, {
    method: 'PUT',
    headers: authHeaders(),
    body: JSON.stringify(body)
  });
  if (!res.ok) throw new Error(`Shopify REST ${res.status}: ${await res.text()}`);
  return res.json();
}

async function gql(query, variables = {}) {
  const res = await fetch(GQL_URL, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ query, variables })
  });
  if (!res.ok) throw new Error(`Shopify GraphQL ${res.status}: ${await res.text()}`);
  const json = await res.json();
  if (json.errors?.length) throw new Error(json.errors.map(e => e.message).join('; '));
  return json.data;
}

function toGid(id) {
  return id.startsWith('gid://') ? id : `gid://shopify/Product/${id}`;
}

async function getActiveTheme() {
  const { themes } = await restGet('/themes.json');
  return themes.find(t => t.role === 'main') || themes[0];
}

async function getThemeSections(themeId) {
  const { assets } = await restGet(`/themes/${themeId}/assets.json`);
  return assets.filter(a => a.key.startsWith('sections/'));
}

async function getThemeSection(themeId, sectionKey) {
  const { asset } = await restGet(
    `/themes/${themeId}/assets.json?asset[key]=${encodeURIComponent(sectionKey)}`
  );
  return asset;
}

async function writeThemeSection(themeId, sectionKey, value) {
  const { asset } = await restPut(`/themes/${themeId}/assets.json`, {
    asset: { key: sectionKey, value }
  });
  return asset;
}

async function duplicateProduct(productId, newTitle) {
  const data = await gql(`
    mutation productDuplicate($productId: ID!, $newTitle: String!) {
      productDuplicate(productId: $productId, newTitle: $newTitle) {
        newProduct { id title handle status }
        userErrors { field message }
      }
    }
  `, { productId: toGid(productId), newTitle });
  const { newProduct, userErrors } = data.productDuplicate;
  if (userErrors.length) throw new Error(userErrors.map(e => e.message).join('; '));
  return newProduct;
}

async function createProduct({ title, descriptionHtml = '', price, variants = [] }) {
  const variantInput = variants.length > 0
    ? variants.map(v => ({ price: String(v.price ?? price), title: v.title || 'Default' }))
    : [{ price: String(price) }];

  const data = await gql(`
    mutation productCreate($input: ProductInput!) {
      productCreate(input: $input) {
        product { id title handle status }
        userErrors { field message }
      }
    }
  `, { input: { title, descriptionHtml, status: 'DRAFT', variants: variantInput } });
  const { product, userErrors } = data.productCreate;
  if (userErrors.length) throw new Error(userErrors.map(e => e.message).join('; '));
  return product;
}

async function setProductDraft(productId) {
  const data = await gql(`
    mutation productUpdate($input: ProductInput!) {
      productUpdate(input: $input) {
        product { id title status }
        userErrors { field message }
      }
    }
  `, { input: { id: toGid(productId), status: 'DRAFT' } });
  const { product, userErrors } = data.productUpdate;
  if (userErrors.length) throw new Error(userErrors.map(e => e.message).join('; '));
  return product;
}

module.exports = {
  getActiveTheme,
  getThemeSections,
  getThemeSection,
  writeThemeSection,
  duplicateProduct,
  createProduct,
  setProductDraft
};
