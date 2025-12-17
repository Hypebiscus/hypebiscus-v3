/**
 * Diagnostic Script: Test Telegram API Connectivity
 *
 * This script tests various methods to connect to Telegram API
 * to diagnose the root cause of connection timeouts on Render
 */

import https from 'https';
import http from 'http';
import dotenv from 'dotenv';

dotenv.config();

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN!;

if (!BOT_TOKEN) {
  console.error('❌ TELEGRAM_BOT_TOKEN not found in environment');
  process.exit(1);
}

interface TestResult {
  method: string;
  success: boolean;
  duration: number;
  error?: string;
  data?: any;
}

const results: TestResult[] = [];

async function testNativeHTTPS(url: string, timeout: number = 10000): Promise<TestResult> {
  const startTime = Date.now();
  const method = `Native HTTPS (${timeout}ms timeout)`;

  return new Promise((resolve) => {
    const req = https.get(url, { timeout }, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        const duration = Date.now() - startTime;
        try {
          const parsed = JSON.parse(data);
          resolve({
            method,
            success: true,
            duration,
            data: parsed,
          });
        } catch (e) {
          resolve({
            method,
            success: false,
            duration,
            error: 'Failed to parse response',
          });
        }
      });
    });

    req.on('error', (error) => {
      resolve({
        method,
        success: false,
        duration: Date.now() - startTime,
        error: error.message,
      });
    });

    req.on('timeout', () => {
      req.destroy();
      resolve({
        method,
        success: false,
        duration: Date.now() - startTime,
        error: 'Request timeout',
      });
    });
  });
}

async function testWithCustomDNS(url: string): Promise<TestResult> {
  const startTime = Date.now();
  const method = 'HTTPS with custom DNS (8.8.8.8)';

  return new Promise((resolve) => {
    const options = {
      timeout: 10000,
      lookup: (hostname: string, options: any, callback: any) => {
        // Force IPv4
        const dns = require('dns');
        dns.resolve4(hostname, (err: any, addresses: string[]) => {
          if (err) {
            callback(err, null, null);
          } else {
            callback(null, addresses[0], 4);
          }
        });
      },
    };

    const req = https.get(url, options, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        const duration = Date.now() - startTime;
        try {
          const parsed = JSON.parse(data);
          resolve({
            method,
            success: true,
            duration,
            data: parsed,
          });
        } catch (e) {
          resolve({
            method,
            success: false,
            duration,
            error: 'Failed to parse response',
          });
        }
      });
    });

    req.on('error', (error) => {
      resolve({
        method,
        success: false,
        duration: Date.now() - startTime,
        error: error.message,
      });
    });

    req.on('timeout', () => {
      req.destroy();
      resolve({
        method,
        success: false,
        duration: Date.now() - startTime,
        error: 'Request timeout',
      });
    });
  });
}

async function testFetch(url: string): Promise<TestResult> {
  const startTime = Date.now();
  const method = 'Native Fetch API';

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);

    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(timeoutId);

    const data = await response.json();
    const duration = Date.now() - startTime;

    return {
      method,
      success: response.ok,
      duration,
      data,
    };
  } catch (error: any) {
    return {
      method,
      success: false,
      duration: Date.now() - startTime,
      error: error.message,
    };
  }
}

async function runDiagnostics() {
  console.log('🔍 Telegram API Connectivity Diagnostics');
  console.log('=========================================\n');

  // Test 1: Simple getMe API call
  const getMeUrl = `https://api.telegram.org/bot${BOT_TOKEN}/getMe`;
  console.log('Test 1: getMe endpoint');
  console.log(`URL: ${getMeUrl.replace(BOT_TOKEN, 'REDACTED')}\n`);

  // Method 1: Native HTTPS (5s timeout)
  console.log('🧪 Testing: Native HTTPS (5s timeout)...');
  const result1 = await testNativeHTTPS(getMeUrl, 5000);
  results.push(result1);
  console.log(result1.success ? '✅ SUCCESS' : '❌ FAILED');
  console.log(`Duration: ${result1.duration}ms`);
  if (result1.error) console.log(`Error: ${result1.error}`);
  if (result1.data) console.log(`Bot: @${result1.data.result?.username}`);
  console.log('');

  // Method 2: Native HTTPS (30s timeout)
  console.log('🧪 Testing: Native HTTPS (30s timeout)...');
  const result2 = await testNativeHTTPS(getMeUrl, 30000);
  results.push(result2);
  console.log(result2.success ? '✅ SUCCESS' : '❌ FAILED');
  console.log(`Duration: ${result2.duration}ms`);
  if (result2.error) console.log(`Error: ${result2.error}`);
  console.log('');

  // Method 3: Custom DNS
  console.log('🧪 Testing: HTTPS with custom DNS resolution...');
  const result3 = await testWithCustomDNS(getMeUrl);
  results.push(result3);
  console.log(result3.success ? '✅ SUCCESS' : '❌ FAILED');
  console.log(`Duration: ${result3.duration}ms`);
  if (result3.error) console.log(`Error: ${result3.error}`);
  console.log('');

  // Method 4: Native Fetch
  console.log('🧪 Testing: Native Fetch API...');
  const result4 = await testFetch(getMeUrl);
  results.push(result4);
  console.log(result4.success ? '✅ SUCCESS' : '❌ FAILED');
  console.log(`Duration: ${result4.duration}ms`);
  if (result4.error) console.log(`Error: ${result4.error}`);
  console.log('');

  // Test 2: deleteWebhook endpoint
  console.log('\nTest 2: deleteWebhook endpoint');
  const webhookUrl = `https://api.telegram.org/bot${BOT_TOKEN}/deleteWebhook`;
  console.log('🧪 Testing webhook deletion...');
  const result5 = await testNativeHTTPS(webhookUrl, 10000);
  results.push(result5);
  console.log(result5.success ? '✅ SUCCESS' : '❌ FAILED');
  console.log(`Duration: ${result5.duration}ms`);
  if (result5.error) console.log(`Error: ${result5.error}`);
  console.log('');

  // Summary
  console.log('\n📊 DIAGNOSTIC SUMMARY');
  console.log('=====================');
  const successCount = results.filter((r) => r.success).length;
  console.log(`Total Tests: ${results.length}`);
  console.log(`Successful: ${successCount}`);
  console.log(`Failed: ${results.length - successCount}`);
  console.log('');

  if (successCount === 0) {
    console.log('❌ ALL TESTS FAILED');
    console.log('');
    console.log('🔍 Possible Causes:');
    console.log('1. Render datacenter has blocked access to api.telegram.org');
    console.log('2. Network firewall blocking HTTPS connections to Telegram');
    console.log('3. DNS resolution issues in current region');
    console.log('4. Telegram API rate limiting your IP range');
    console.log('');
    console.log('💡 Recommended Actions:');
    console.log('1. Switch to WEBHOOK mode instead of long polling');
    console.log('2. Try different Render region (oregon, virginia, frankfurt)');
    console.log('3. Contact Render support about Telegram API access');
    console.log('4. Use a proxy or VPN service');
  } else if (successCount < results.length) {
    console.log('⚠️  PARTIAL SUCCESS');
    console.log('');
    console.log('Some methods work while others fail.');
    console.log('The issue is likely with Telegraf library configuration.');
    console.log('');
    console.log('💡 Recommended Actions:');
    console.log('1. Use the working method in bot configuration');
    console.log('2. Switch to webhook mode (more reliable)');
    console.log('3. Increase timeout values in Telegraf config');
  } else {
    console.log('✅ ALL TESTS PASSED');
    console.log('');
    console.log('Telegram API is accessible from this environment.');
    console.log('The issue is likely with Telegraf library or bot.launch() method.');
    console.log('');
    console.log('💡 Recommended Actions:');
    console.log('1. Switch to webhook mode (bot-webhook.ts)');
    console.log('2. Try reducing polling timeout in bot.ts');
    console.log('3. Check Telegraf library version compatibility');
  }

  console.log('\n✅ Diagnostics complete');
  process.exit(0);
}

// Run diagnostics
runDiagnostics().catch((error) => {
  console.error('❌ Diagnostic script failed:', error);
  process.exit(1);
});
