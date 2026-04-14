/**
 * Alert Manager - Multi-channel alerting module
 * Supports: webhook (critical/warning/info)
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');

const ROOT = __dirname;
const CONFIG_FILE = path.join(ROOT, '..', 'config', 'stability.json');

function readConfig() {
  const defaultConfig = {
    alert: {
      enabled: true,
      channels: ['webhook'],
      webhookUrl: '',
      webhookMethod: 'POST',
      levels: {
        critical: { enabled: true },
        warning: { enabled: true },
        info: { enabled: false }
      }
    }
  };
  
  if (!fs.existsSync(CONFIG_FILE)) {
    return defaultConfig;
  }
  
  try {
    const config = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
    return {
      alert: { ...defaultConfig.alert, ...config.alert }
    };
  } catch (e) {
    return defaultConfig;
  }
}

/**
 * Send HTTP request (webhook)
 */
function sendWebhook(url, payload, method = 'POST') {
  return new Promise((resolve, reject) => {
    try {
      const urlObj = new URL(url);
      const isHttps = urlObj.protocol === 'https:';
      const client = isHttps ? https : http;
      
      const data = JSON.stringify(payload);
      const options = {
        hostname: urlObj.hostname,
        port: urlObj.port || (isHttps ? 443 : 80),
        path: urlObj.pathname + urlObj.search,
        method: method,
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(data)
        },
        timeout: 10000
      };
      
      const req = client.request(options, (res) => {
        let body = '';
        res.on('data', chunk => body += chunk);
        res.on('end', () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve({ success: true, statusCode: res.statusCode, body });
          } else {
            reject(new Error(`HTTP ${res.statusCode}: ${body}`));
          }
        });
      });
      
      req.on('error', reject);
      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Request timeout'));
      });
      
      req.write(data);
      req.end();
    } catch (e) {
      reject(e);
    }
  });
}

/**
 * Build alert message
 */
function buildAlertMessage(level, event, data) {
  const timestamp = new Date().toISOString();
  const severity = {
    critical: '🔴',
    warning: '🟡',
    info: '🔵'
  }[level] || '⚪';
  
  return {
    alert: {
      level,
      event,
      timestamp,
      severity,
      data
    }
  };
}

/**
 * Send alert to configured channels
 * @param {string} level - critical | warning | info
 * @param {string} event - Event type (e.g., 'dependency_cycle', 'circuit_breaker')
 * @param {Object} data - Alert payload
 * @returns {Promise<Array>} Results from each channel
 */
async function sendAlert(level, event, data) {
  const config = readConfig();
  
  if (!config.alert?.enabled) {
    return [{ channel: 'none', success: true, reason: 'disabled' }];
  }
  
  // Check level enabled
  const levelConfig = config.alert?.levels?.[level];
  if (levelConfig && !levelConfig.enabled) {
    return [{ channel: 'none', success: true, reason: `${level} disabled` }];
  }
  
  const message = buildAlertMessage(level, event, data);
  const results = [];
  
  // Webhook channel
  if (config.alert?.channels?.includes('webhook') && config.alert?.webhookUrl) {
    try {
      const result = await sendWebhook(
        config.alert.webhookUrl,
        message,
        config.alert.webhookMethod || 'POST'
      );
      results.push({ channel: 'webhook', success: true, ...result });
    } catch (e) {
      results.push({ channel: 'webhook', success: false, error: e.message });
    }
  }
  
  return results;
}

/**
 * Convenience methods for common alert types
 */
async function alertDependencyCycle(detectedCycle, broken = false) {
  return sendAlert('critical', 'dependency_cycle', {
    cycle: detectedCycle,
    autoBroken: broken,
    message: `Dependency cycle detected: ${detectedCycle.join(' → ')}`
  });
}

async function alertCircuitBreaker(agentLabel, failureCount, action) {
  return sendAlert('warning', 'circuit_breaker', {
    agent: agentLabel,
    failureCount,
    action,
    message: `Circuit breaker triggered for ${agentLabel}: ${action}`
  });
}

async function alertZombieAgent(agentLabel, ageMinutes) {
  return sendAlert('warning', 'zombie_agent', {
    agent: agentLabel,
    ageMinutes,
    message: `Zombie agent detected: ${agentLabel} running for ${ageMinutes}min`
  });
}

async function alertTaskTimeout(taskId, agentLabel, ageMs) {
  return sendAlert('critical', 'task_timeout', {
    taskId,
    agent: agentLabel,
    ageMs,
    ageMinutes: Math.round(ageMs / 60000),
    message: `Task timeout: ${taskId} (${agentLabel})`
  });
}

async function alertHealthIssue(issue) {
  const level = issue.severity === 'high' ? 'critical' : 'warning';
  return sendAlert(level, 'health_issue', {
    type: issue.type,
    agent: issue.agent,
    message: issue.message
  });
}

/**
 * Simple sync version for non-async contexts
 */
function sendAlertSync(level, event, data) {
  return sendAlert(level, event, data).catch(e => {
    console.error(`[AlertManager] Failed to send ${level} alert: ${e.message}`);
    return [{ channel: 'webhook', success: false, error: e.message }];
  });
}

module.exports = {
  sendAlert,
  sendAlertSync,
  alertDependencyCycle,
  alertCircuitBreaker,
  alertZombieAgent,
  alertTaskTimeout,
  alertHealthIssue,
  readConfig
};
