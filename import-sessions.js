const fs = require('fs');
const path = require('path');
const SESSIONS_DIR = path.join(process.env.HOME, '.openclaw/sessions');
const MEMORY_DIR = path.join(process.env.HOME, '.openclaw/memory');

if (!fs.existsSync(SESSIONS_DIR)) {
  console.log('No sessions directory found.');
  process.exit(0);
}

function storeMemory(entry) {
  if (!fs.existsSync(MEMORY_DIR)) {
    fs.mkdirSync(MEMORY_DIR, { recursive: true });
  }
  const file = path.join(MEMORY_DIR, 'enhanced-backup.jsonl');
  const line = JSON.stringify({
    ...entry,
    stored_at: Date.now()
  }) + '
';
  fs.appendFileSync(file, line);
  return true;
}

const files = fs.readdirSync(SESSIONS_DIR).filter(f => f.endsWith('.jsonl') && !f.includes('.deleted.'));
let imported = 0;

for (const file of files) {
  const sessionId = file.replace('.jsonl', '');
  const lines = fs.readFileSync(path.join(SESSIONS_DIR, file), 'utf8').split('
').filter(Boolean);
  
  for (const line of lines) {
    try {
      const msg = JSON.parse(line);
      if (msg.role === 'user' && msg.content) {
        let contentStr = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content);
        const lower = contentStr.toLowerCase();
        
        let category = 'fact';
        let importance = 0.5;
        
        if (lower.includes('prefer') || lower.includes('like') || lower.includes('always')) {
          category = 'preference';
          importance = 0.9;
        } else if (lower.includes('decide') || lower.includes('choose')) {
          category = 'decision';
          importance = 0.8;
        } else if (lower.includes('token') || lower.includes('password') || lower.includes('key')) {
          category = 'secret';
          importance = 1.0;
        }
        
        storeMemory({
          session_id: sessionId,
          category: category,
          importance: importance,
          text: contentStr.slice(0, 500)
        });
        imported++;
      }
    } catch (e) {
    }
  }
}

console.log('Successfully imported ' + imported + ' entries from ' + files.length + ' sessions.');
