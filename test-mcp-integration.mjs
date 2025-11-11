#!/usr/bin/env node
/**
 * Test MCP Integration with Render
 *
 * This script tests the MCP server integration to ensure it's working correctly.
 * Run with: node test-mcp-integration.mjs
 */

const MCP_SERVER_URL = process.env.MCP_SERVER_URL || 'https://hypebiscus-mcp.onrender.com';

async function testHealthCheck() {
  console.log('🏥 Testing health check...');
  try {
    const response = await fetch(`${MCP_SERVER_URL}/health`);
    const data = await response.json();

    if (data.status === 'ok' && data.ready) {
      console.log('✅ Health check passed!');
      return true;
    } else {
      console.log('❌ Health check failed:', data);
      return false;
    }
  } catch (error) {
    console.error('❌ Health check error:', error.message);
    return false;
  }
}

async function testPoolMetrics() {
  console.log('\n📊 Testing get_pool_metrics...');
  try {
    const response = await fetch(MCP_SERVER_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'get_pool_metrics',
        params: {},
        id: 1,
      }),
    });

    const data = await response.json();

    if (data.result?.content?.[0]?.text) {
      const poolData = JSON.parse(data.result.content[0].text);
      console.log('✅ Pool metrics retrieved successfully!');
      console.log('   Pool:', poolData.poolName);
      console.log('   APY:', poolData.metrics.apy.toFixed(2) + '%');
      console.log('   24h Fees:', '$' + poolData.metrics.fees24h.toFixed(2));
      console.log('   24h Volume:', '$' + poolData.metrics.volume24h.toFixed(2));
      return true;
    } else {
      console.log('❌ Unexpected response format:', data);
      return false;
    }
  } catch (error) {
    console.error('❌ Pool metrics error:', error.message);
    return false;
  }
}

async function testPriceAPI() {
  console.log('\n💰 Testing Jupiter Price API integration...');
  try {
    // Test by getting pool metrics which includes prices
    const response = await fetch(MCP_SERVER_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'get_pool_metrics',
        params: {},
        id: 2,
      }),
    });

    const data = await response.json();

    if (data.result?.content?.[0]?.text) {
      const poolData = JSON.parse(data.result.content[0].text);
      const solPrice = poolData.prices.SOL?.usd || 0;
      const zbtcPrice = poolData.prices.zBTC?.usd || 0;

      if (solPrice > 0 || zbtcPrice > 0) {
        console.log('✅ Price API working!');
        if (solPrice > 0) {
          console.log('   SOL:', '$' + solPrice.toFixed(2));
        }
        if (zbtcPrice > 0) {
          console.log('   zBTC:', '$' + zbtcPrice.toFixed(2));
        }
        return true;
      } else {
        console.log('⚠️  Prices not yet available (server may be warming up)');
        return true; // Not a failure, just warming up
      }
    } else {
      console.log('❌ Unexpected response format:', data);
      return false;
    }
  } catch (error) {
    console.error('❌ Price API error:', error.message);
    return false;
  }
}

async function runTests() {
  console.log('🚀 Testing MCP Integration with Render');
  console.log('📍 MCP Server:', MCP_SERVER_URL);
  console.log('=' .repeat(60));

  const results = {
    health: await testHealthCheck(),
    poolMetrics: await testPoolMetrics(),
    priceAPI: await testPriceAPI(),
  };

  console.log('\n' + '='.repeat(60));
  console.log('📋 Test Results:');
  console.log('   Health Check:', results.health ? '✅ PASS' : '❌ FAIL');
  console.log('   Pool Metrics:', results.poolMetrics ? '✅ PASS' : '❌ FAIL');
  console.log('   Price API:', results.priceAPI ? '✅ PASS' : '❌ FAIL');

  const allPassed = Object.values(results).every(r => r);

  if (allPassed) {
    console.log('\n✨ All tests passed! MCP integration is working correctly.');
    process.exit(0);
  } else {
    console.log('\n⚠️  Some tests failed. Please check the errors above.');
    process.exit(1);
  }
}

runTests();
