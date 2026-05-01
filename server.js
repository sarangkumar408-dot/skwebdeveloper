const express = require('express');
const path = require('path');
const fs = require('fs');

const app = express();
const port = process.env.PORT || 3000;
const dataDir = path.join(__dirname, 'data');
const messagesFile = path.join(dataDir, 'messages.json');
const visitsFile = path.join(dataDir, 'visits.json');

app.use(express.json());
app.use(express.static(path.join(__dirname)));

function ensureDataFile() {
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
  if (!fs.existsSync(messagesFile)) {
    fs.writeFileSync(messagesFile, '[]', 'utf8');
  }
  if (!fs.existsSync(visitsFile)) {
    fs.writeFileSync(visitsFile, '[]', 'utf8');
  }
}

function readMessages() {
  ensureDataFile();
  const raw = fs.readFileSync(messagesFile, 'utf8');
  try {
    return JSON.parse(raw);
  } catch (error) {
    return [];
  }
}

function writeMessages(messages) {
  ensureDataFile();
  fs.writeFileSync(messagesFile, JSON.stringify(messages, null, 2), 'utf8');
}

// Visit tracking functions
function readVisits() {
  ensureDataFile();
  const raw = fs.readFileSync(visitsFile, 'utf8');
  try {
    return JSON.parse(raw);
  } catch (error) {
    return [];
  }
}

function writeVisits(visits) {
  ensureDataFile();
  fs.writeFileSync(visitsFile, JSON.stringify(visits, null, 2), 'utf8');
}

// Simple hash function for anonymizing IPs
function anonymizeIP(ip) {
  // Simple hash to anonymize IP addresses
  let hash = 0;
  for (let i = 0; i < ip.length; i++) {
    const char = ip.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return Math.abs(hash).toString(16).padStart(8, '0');
}

// Check if visit is from same session (within last 30 minutes)
function isDuplicateVisit(visits, sessionId, ipHash) {
  const thirtyMinutesAgo = Date.now() - (30 * 60 * 1000);
  return visits.some(v => 
    (v.sessionId === sessionId || v.ipHash === ipHash) && 
    new Date(v.timestamp).getTime() > thirtyMinutesAgo
  );
}

app.get('/api/messages', (req, res) => {
  const messages = readMessages();
  const contact = req.query.contact;
  if (contact) {
    const normalized = contact.toLowerCase().trim();
    return res.json(messages.filter(item => item.contact && item.contact.toLowerCase().trim() === normalized));
  }
  res.json(messages);
});

app.post('/api/messages', (req, res) => {
  const { name, contact, message } = req.body;
  if (!name || !message) {
    return res.status(400).json({ error: 'Name and message are required.' });
  }

  const messages = readMessages();
  const newMessage = {
    id: Date.now().toString() + Math.random().toString(16).slice(2),
    name,
    contact: contact || '',
    message,
    status: 'pending',
    responseMessage: 'Your request is pending and waiting for admin review.',
    receivedAt: new Date().toISOString()
  };

  messages.push(newMessage);
  writeMessages(messages);

  res.status(201).json(newMessage);
});

app.put('/api/messages/:id/status', (req, res) => {
  const { id } = req.params;
  const { status } = req.body;
  const validStatuses = ['pending', 'accepted', 'rejected'];

  if (!validStatuses.includes(status)) {
    return res.status(400).json({ error: 'Invalid status.' });
  }

  const messages = readMessages();
  const message = messages.find(item => item.id === id);
  if (!message) {
    return res.status(404).json({ error: 'Message not found.' });
  }

  message.status = status;
  message.responseMessage =
    status === 'accepted'
      ? 'The meeting request has been accepted. SK Web Solutions will contact the client shortly.'
      : status === 'rejected'
      ? 'The meeting request has been rejected. The client will be notified and may submit a new request if needed.'
      : 'The request is pending and awaiting admin review.';

  writeMessages(messages);
  res.json(message);
});

app.delete('/api/messages', (req, res) => {
  writeMessages([]);
  res.json({ success: true });
});

// SMS Reply endpoint
app.post('/api/messages/:id/sms', (req, res) => {
  const { id } = req.params;
  const { to, from, message, sentAt } = req.body;

  if (!to || !message) {
    return res.status(400).json({ error: 'To and message are required.' });
  }

  const messages = readMessages();
  const msg = messages.find(item => item.id === id);
  if (!msg) {
    return res.status(404).json({ error: 'Message not found.' });
  }

  // Store SMS reply
  msg.smsReplies = msg.smsReplies || [];
  msg.smsReplies.push({
    to,
    from: from || 'SK Web Solutions',
    message,
    sentAt: sentAt || new Date().toISOString()
  });
  msg.lastReplyAt = sentAt || new Date().toISOString();

  writeMessages(messages);
  res.json({ success: true, smsId: Date.now().toString() });
});

// Visit tracking endpoints
app.get('/api/visits', (req, res) => {
  const visits = readVisits();
  
  // Calculate statistics
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const weekStart = new Date(todayStart);
  weekStart.setDate(weekStart.getDate() - 7);
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  
  const todayVisits = visits.filter(v => new Date(v.timestamp) >= todayStart).length;
  const weekVisits = visits.filter(v => new Date(v.timestamp) >= weekStart).length;
  const monthVisits = visits.filter(v => new Date(v.timestamp) >= monthStart).length;
  const totalVisits = visits.length;
  
  // Get unique visitors (by anonymized IP)
  const uniqueVisitors = new Set(visits.map(v => v.ipHash)).size;
  
  // Daily visits for the last 30 days
  const dailyVisits = [];
  for (let i = 29; i >= 0; i--) {
    const dayStart = new Date(todayStart);
    dayStart.setDate(dayStart.getDate() - i);
    const dayEnd = new Date(dayStart);
    dayEnd.setDate(dayEnd.getDate() + 1);
    
    const count = visits.filter(v => {
      const visitDate = new Date(v.timestamp);
      return visitDate >= dayStart && visitDate < dayEnd;
    }).length;
    
    dailyVisits.push({
      date: dayStart.toISOString().split('T')[0],
      count
    });
  }
  
  res.json({
    total: totalVisits,
    today: todayVisits,
    week: weekVisits,
    month: monthVisits,
    uniqueVisitors,
    dailyVisits
  });
});

app.post('/api/visits', (req, res) => {
  const { sessionId, userAgent } = req.body;
  const ip = req.ip || req.connection.remoteAddress || 'unknown';
  const ipHash = anonymizeIP(ip);
  
  const visits = readVisits();
  
  // Check for duplicate visits within 30 minutes
  if (sessionId && isDuplicateVisit(visits, sessionId, ipHash)) {
    return res.json({ success: true, duplicate: true });
  }
  
  const newVisit = {
    id: Date.now().toString() + Math.random().toString(16).slice(2),
    timestamp: new Date().toISOString(),
    ipHash,
    sessionId: sessionId || null,
    userAgent: userAgent || '',
    referrer: req.get('Referrer') || ''
  };
  
  visits.push(newVisit);
  writeVisits(visits);
  
  res.json({ success: true, duplicate: false, visit: newVisit });
});

app.get('/api/visits/history', (req, res) => {
  const visits = readVisits();
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 50;
  const startDate = req.query.startDate;
  const endDate = req.query.endDate;
  
  let filteredVisits = visits;
  
  if (startDate) {
    filteredVisits = filteredVisits.filter(v => new Date(v.timestamp) >= new Date(startDate));
  }
  if (endDate) {
    filteredVisits = filteredVisits.filter(v => new Date(v.timestamp) <= new Date(endDate + 'T23:59:59'));
  }
  
  // Sort by most recent first
  filteredVisits.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
  
  // Paginate
  const totalFiltered = filteredVisits.length;
  const startIndex = (page - 1) * limit;
  const paginatedVisits = filteredVisits.slice(startIndex, startIndex + limit);
  
  res.json({
    visits: paginatedVisits,
    pagination: {
      page,
      limit,
      total: totalFiltered,
      totalPages: Math.ceil(totalFiltered / limit)
    }
  });
});

app.delete('/api/visits', (req, res) => {
  writeVisits([]);
  res.json({ success: true });
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(port, () => {
  console.log(`SK Web Solutions server running at http://localhost:${port}`);
});
