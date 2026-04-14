// Cloudflare Worker - Full backend for Drained RCE Mobile
// Requires KV binding named "DRAINED_RCE"

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    // CORS headers
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    };
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    // Helper: get user from session cookie
    async function getUser(sessionId) {
      if (!sessionId) return null;
      const userData = await env.DRAINED_RCE.get(`session:${sessionId}`);
      return userData ? JSON.parse(userData) : null;
    }

    // Discord OAuth
    if (path === '/auth/discord') {
      const discordAuthUrl = `https://discord.com/api/oauth2/authorize?client_id=${env.DISCORD_CLIENT_ID}&redirect_uri=${encodeURIComponent(env.BRIDGE_URL)}/auth/discord/callback&response_type=code&scope=identify`;
      return Response.redirect(discordAuthUrl, 302);
    }

    if (path === '/auth/discord/callback') {
      const code = url.searchParams.get('code');
      if (!code) return new Response('Missing code', { status: 400 });
      
      const tokenRes = await fetch('https://discord.com/api/oauth2/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: env.DISCORD_CLIENT_ID,
          client_secret: env.DISCORD_CLIENT_SECRET,
          grant_type: 'authorization_code',
          code: code,
          redirect_uri: `${env.BRIDGE_URL}/auth/discord/callback`,
        }),
      });
      const tokenData = await tokenRes.json();
      const userRes = await fetch('https://discord.com/api/users/@me', {
        headers: { Authorization: `Bearer ${tokenData.access_token}` },
      });
      const discordUser = await userRes.json();

      let user = await env.DRAINED_RCE.get(`user:${discordUser.id}`);
      if (!user) {
        user = {
          id: discordUser.id,
          discord_username: discordUser.username,
          discord_avatar: discordUser.avatar,
          token_balance: 1000,
          ingame_name: null,
          steam_id: null,
        };
        await env.DRAINED_RCE.put(`user:${discordUser.id}`, JSON.stringify(user));
      } else {
        user = JSON.parse(user);
      }
      
      const sessionId = crypto.randomUUID();
      await env.DRAINED_RCE.put(`session:${sessionId}`, JSON.stringify(user), { expirationTtl: 86400 });
      return new Response(null, {
        status: 302,
        headers: {
          'Location': `${env.FRONTEND_URL}?auth=success`,
          'Set-Cookie': `session=${sessionId}; Path=/; HttpOnly; SameSite=Lax`,
          ...corsHeaders,
        },
      });
    }

    const cookie = request.headers.get('Cookie');
    const sessionId = cookie?.match(/session=([^;]+)/)?.[1];
    const user = await getUser(sessionId);
    if (!user && path !== '/auth/me') {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: corsHeaders });
    }

    // Routes
    if (path === '/auth/me' && request.method === 'GET') {
      return new Response(JSON.stringify({ user }), { headers: corsHeaders });
    }
    if (path === '/auth/logout' && request.method === 'POST') {
      if (sessionId) await env.DRAINED_RCE.delete(`session:${sessionId}`);
      return new Response(JSON.stringify({ success: true }), { headers: corsHeaders });
    }

    if (path === '/shop/items' && request.method === 'GET') {
      let items = await env.DRAINED_RCE.get('shop_items');
      if (!items) {
        items = [
          { id: 1, name: 'Wood x1000', price: 50, description: '1000 wood', command: 'inventory.give {steam_id} wood 1000' },
          { id: 2, name: 'Stone x1000', price: 50, description: '1000 stone', command: 'inventory.give {steam_id} stones 1000' },
          { id: 3, name: 'Metal Frag x500', price: 100, description: '500 metal fragments', command: 'inventory.give {steam_id} metal.fragments 500' },
          { id: 4, name: 'Semi-Auto Rifle', price: 500, description: 'One rifle', command: 'inventory.give {steam_id} rifle.semiauto 1' },
        ];
        await env.DRAINED_RCE.put('shop_items', JSON.stringify(items));
      } else {
        items = JSON.parse(items);
      }
      return new Response(JSON.stringify(items), { headers: corsHeaders });
    }

    if (path === '/shop/purchase' && request.method === 'POST') {
      const { itemId } = await request.json();
      const items = JSON.parse(await env.DRAINED_RCE.get('shop_items') || '[]');
      const item = items.find(i => i.id === itemId);
      if (!item) return new Response(JSON.stringify({ error: 'Item not found' }), { status: 404, headers: corsHeaders });
      if (user.token_balance < item.price) return new Response(JSON.stringify({ error: 'Insufficient tokens' }), { status: 400, headers: corsHeaders });
      
      user.token_balance -= item.price;
      await env.DRAINED_RCE.put(`user:${user.id}`, JSON.stringify(user));
      if (sessionId) await env.DRAINED_RCE.put(`session:${sessionId}`, JSON.stringify(user), { expirationTtl: 86400 });
      
      let command = item.command;
      if (user.steam_id) command = command.replace('{steam_id}', user.steam_id);
      try {
        await sendRcon(command, env);
      } catch (err) {
        user.token_balance += item.price;
        await env.DRAINED_RCE.put(`user:${user.id}`, JSON.stringify(user));
        return new Response(JSON.stringify({ error: 'RCON failed' }), { status: 500, headers: corsHeaders });
      }
      return new Response(JSON.stringify({ success: true, newBalance: user.token_balance }), { headers: corsHeaders });
    }

    if (path === '/teleport' && request.method === 'POST') {
      const { x, y, z, waypoint } = await request.json();
      let command;
      if (waypoint) command = `tpr ${waypoint}`;
      else command = `teleportpos ${x} ${y} ${z}`;
      try {
        await sendRcon(command, env);
        return new Response(JSON.stringify({ success: true }), { headers: corsHeaders });
      } catch (err) {
        return new Response(JSON.stringify({ error: 'RCON teleport failed' }), { status: 500, headers: corsHeaders });
      }
    }

    if (path === '/user/balance' && request.method === 'GET') {
      return new Response(JSON.stringify({ balance: user.token_balance }), { headers: corsHeaders });
    }

    if (path === '/user/link' && request.method === 'POST') {
      const { ingameName, steamId } = await request.json();
      user.ingame_name = ingameName;
      user.steam_id = steamId;
      await env.DRAINED_RCE.put(`user:${user.id}`, JSON.stringify(user));
      if (sessionId) await env.DRAINED_RCE.put(`session:${sessionId}`, JSON.stringify(user), { expirationTtl: 86400 });
      return new Response(JSON.stringify({ success: true }), { headers: corsHeaders });
    }

    if (path === '/map/markers' && request.method === 'GET') {
      let markers = await env.DRAINED_RCE.get('map_markers');
      if (!markers) markers = '[]';
      return new Response(markers, { headers: corsHeaders });
    }

    return new Response('Not Found', { status: 404, headers: corsHeaders });
  },
};

async function sendRcon(command, env) {
  const net = require('net');
  return new Promise((resolve, reject) => {
    const client = net.createConnection({ host: env.RCON_HOST, port: env.RCON_PORT }, () => {
      const packet = Buffer.alloc(12 + command.length);
      packet.writeInt32LE(command.length + 10, 0);
      packet.writeInt32LE(1, 4);
      packet.write(command, 8);
      packet.writeInt32LE(0, 8 + command.length);
      client.write(packet);
    });
    client.on('data', () => {
      client.end();
      resolve();
    });
    client.on('error', reject);
    setTimeout(() => reject(new Error('RCON timeout')), 5000);
  });
}