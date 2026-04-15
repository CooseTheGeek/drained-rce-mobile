require('dotenv').config();
const express = require('express');
const cors = require('cors');
const session = require('express-session');
const passport = require('passport');
const DiscordStrategy = require('passport-discord').Strategy;
const { createClient } = require('@supabase/supabase-js');
const { Rcon } = require('rcon-client');

const app = express();
app.use(cors({ origin: process.env.FRONTEND_URL, credentials: true }));
app.use(express.json());
app.use(session({
  secret: process.env.SESSION_SECRET || 'keyboard cat',
  resave: false,
  saveUninitialized: false,
  cookie: { secure: false, sameSite: 'lax' }
}));
app.use(passport.initialize());
app.use(passport.session());
app.get('/test', (req, res) => {
  res.json({ message: 'Backend is alive!' });
});

// Supabase
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

// RCON connection
let rconClient = null;
async function getRcon() {
  if (!rconClient || !rconClient.connected) {
    rconClient = new Rcon({
      host: process.env.RCON_HOST,
      port: parseInt(process.env.RCON_PORT),
      password: process.env.RCON_PASSWORD,
    });
    await rconClient.connect();
  }
  return rconClient;
}

// Discord OAuth
passport.use(new DiscordStrategy({
  clientID: process.env.DISCORD_CLIENT_ID,
  clientSecret: process.env.DISCORD_CLIENT_SECRET,
  callbackURL: `${process.env.BRIDGE_URL}/auth/discord/callback`,
  scope: ['identify'],
}, async (accessToken, refreshToken, profile, done) => {
  let { data: user } = await supabase
    .from('users')
    .select('*')
    .eq('discord_id', profile.id)
    .single();

  if (!user) {
    const { data: newUser } = await supabase
      .from('users')
      .insert({
        discord_id: profile.id,
        discord_username: profile.username,
        discord_avatar: profile.avatar,
        token_balance: 1000,
      })
      .select()
      .single();
    user = newUser;
  }
  return done(null, user);
}));

passport.serializeUser((user, done) => done(null, user.id));
passport.deserializeUser(async (id, done) => {
  const { data: user } = await supabase.from('users').select('*').eq('id', id).single();
  done(null, user);
});

// Auth routes
app.get('/auth/discord', passport.authenticate('discord'));
app.get('/auth/discord/callback', passport.authenticate('discord', { failureRedirect: '/' }), (req, res) => {
  res.redirect(`${process.env.FRONTEND_URL}?auth=success`);
});
app.get('/auth/me', (req, res) => {
  if (req.user) return res.json({ user: req.user });
  res.status(401).json({ error: 'Not logged in' });
});
app.post('/auth/logout', (req, res) => {
  req.logout(() => res.json({ success: true }));
});

// Shop endpoints
app.get('/shop/items', async (req, res) => {
  const { data, error } = await supabase.from('shop_items').select('*');
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

app.post('/shop/purchase', async (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
  const { itemId } = req.body;
  const { data: item, error: itemError } = await supabase
    .from('shop_items')
    .select('*')
    .eq('id', itemId)
    .single();
  if (itemError || !item) return res.status(404).json({ error: 'Item not found' });
  if (req.user.token_balance < item.price) {
    return res.status(400).json({ error: 'Insufficient tokens' });
  }

  const newBalance = req.user.token_balance - item.price;
  const { error: updateError } = await supabase
    .from('users')
    .update({ token_balance: newBalance })
    .eq('id', req.user.id);
  if (updateError) return res.status(500).json({ error: 'Failed to update balance' });

  let command = item.command;
  if (req.user.steam_id) {
    command = command.replace('{steam_id}', req.user.steam_id);
  }
  try {
    const rcon = await getRcon();
    await rcon.send(command);
    res.json({ success: true, newBalance });
  } catch (err) {
    await supabase.from('users').update({ token_balance: req.user.token_balance }).eq('id', req.user.id);
    res.status(500).json({ error: 'RCON command failed' });
  }
});

// Teleport
app.post('/teleport', async (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
  const { x, y, z, waypoint } = req.body;
  let command;
  if (waypoint) {
    command = `tpr ${waypoint}`;
  } else if (x !== undefined && y !== undefined && z !== undefined) {
    command = `teleportpos ${x} ${y} ${z}`;
  } else {
    return res.status(400).json({ error: 'Invalid teleport target' });
  }
  try {
    const rcon = await getRcon();
    await rcon.send(command);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'RCON teleport failed' });
  }
});

// User balance
app.get('/user/balance', async (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
  res.json({ balance: req.user.token_balance });
});

// Link in-game name and Steam ID
app.post('/user/link', async (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
  const { ingameName, steamId } = req.body;
  const { error } = await supabase
    .from('users')
    .update({ ingame_name: ingameName, steam_id: steamId })
    .eq('id', req.user.id);
  if (error) return res.status(500).json({ error: 'Failed to link' });
  res.json({ success: true });
});

// Map markers
app.get('/map/markers', async (req, res) => {
  const { data } = await supabase.from('map_markers').select('*');
  res.json(data || []);
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`Backend running on port ${PORT}`));