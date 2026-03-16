#!/usr/bin/env node
/**
 * Verify Output - 验证编排输出的正确性
 * 
 * 用法：
 *   node demo/verify-output.js [任务描述]
 * 
 * 验证内容：
 * 1. JSON 格式正确
 * 2. 包含必要字段: taskId, mode, spawnInstructions
 * 3. spawn 指令格式正确
 * 4. roleId 映射正确
 */

const path = require('path');

const ROOT = path.join(__dirname, '..');
const { orchestrate } = require(path.join(ROOT, 'orchestrator-main'));

const REQUIRED_FIELDS = ['taskId', 'mode', 'context', 'plan', 'allocation', 'spawnInstructions'];
const SPAWN_REQUIRED_FIELDS = ['label', 'roleId', 'title', 'prompt', 'spawnCall'];

function verifyJsonStructure(data) {
  const errors = [];
  
  for (const field of REQUIRED_FIELDS) {
    if (!data[field]) {
      errors.push(`Missing required field: ${field}`);
    }
  }
  
  return errors;
}

function verifySpawnInstruction(inst) {
  const errors = [];
  
  for (const field of SPAWN_REQUIRED_FIELDS) {
    if (!inst[field]) {
      errors.push(`Missing spawn instruction field: ${field}`);
    }
  }
  
  // 验证 spawnCall 格式
  if (inst.spawnCall) {
    const callFields = ['runtime', 'mode', 'label', 'model'];
    for (const field of callFields) {
      if (!inst.spawnCall[field]) {
        errors.push(`Missing spawnCall field: ${field}`);
      }
    }
  }
  
  return errors;
}

function verifyTaskId(taskId) {
  const errors = [];
  
  if (!taskId || !taskId.startsWith('task-')) {
    errors.push(`Invalid taskId format: ${taskId}`);
  }
  
  return errors;
}

async function verify(taskText) {
  console.log('========== Output Verification ==========\n');
  console.log(`Task: ${taskText}`);
  console.log('');
  
  try {
    const result = await orchestrate(taskText, {
      verbose: false,
      context: {
        sessionId: 'verify-session',
        taskRoot: ROOT
      }
    });
    
    let passCount = 0;
    let failCount = 0;
    
    // 1. 验证 JSON 结构
    console.log('[1/5] 验证 JSON 结构...');
    const structErrors = verifyJsonStructure(result);
    if (structErrors.length > 0) {
      console.log('  ❌ FAIL');
      structErrors.forEach(e => console.log(`     - ${e}`));
      failCount++;
    } else {
      console.log('  ✅ PASS');
      passCount++;
    }
    
    // 2. 验证 taskId 格式
    console.log('[2/5] 验证 taskId 格式...');
    const idErrors = verifyTaskId(result.taskId);
    if (idErrors.length > 0) {
      console.log('  ❌ FAIL');
      idErrors.forEach(e => console.log(`     - ${e}`));
      failCount++;
    } else {
      console.log('  ✅ PASS');
      console.log(`     taskId: ${result.taskId}`);
      passCount++;
    }
    
    // 3. 验证模式
    console.log('[3/5] 验证执行模式...');
    if (result.mode === 'single' || result.mode === 'multi') {
      console.log('  ✅ PASS');
      console.log(`     mode: ${result.mode}`);
      if (result.plan?.executionMode) {
        console.log(`     executionMode: ${result.plan.executionMode}`);
      }
      passCount++;
    } else {
      console.log('  ❌ FAIL');
      console.log(`     Invalid mode: ${result.mode}`);
      failCount++;
    }
    
    // 4. 验证 spawn 指令
    console.log('[4/5] 验证 Spawn 指令...');
    if (result.spawnInstructions && result.spawnInstructions.length > 0) {
      let spawnPass = true;
      for (const inst of result.spawnInstructions) {
        const instErrors = verifySpawnInstruction(inst);
        if (instErrors.length > 0) {
          console.log(`  ❌ FAIL: ${inst.label}`);
          instErrors.forEach(e => console.log(`     - ${e}`));
          spawnPass = false;
        }
      }
      if (spawnPass) {
        console.log('  ✅ PASS');
        console.log(`     ${result.spawnInstructions.length} 个 agent 待 spawn`);
        result.spawnInstructions.forEach((inst, i) => {
          console.log(`       [${i + 1}] ${inst.roleId} -> ${inst.label}`);
        });
        passCount++;
      } else {
        failCount++;
      }
    } else {
      console.log('  ⚠️  WARN: 无 spawn 指令 (可能是单 agent 模式)');
    }
    
    // 5. 验证角色映射
    console.log('[5/5] 验证角色分配...');
    if (result.plan?.selectedRoles && result.plan.selectedRoles.length > 0) {
      console.log('  ✅ PASS');
      console.log(`     ${result.plan.selectedRoles.length} 个角色被选中`);
      result.plan.selectedRoles.forEach(role => {
        console.log(`       - ${role.id}: ${role.instances} instance(s), capabilities: ${role.capabilities.join(', ')}`);
      });
      passCount++;
    } else {
      console.log('  ⚠️  WARN: 无角色分配');
    }
    
    // 总结
    console.log('\n========== Verification Summary ==========');
    console.log(`Total: ${passCount + failCount}`);
    console.log(`✅ PASS: ${passCount}`);
    console.log(`❌ FAIL: ${failCount}`);
    console.log('');
    
    if (failCount === 0) {
      console.log('🎉 所有验证通过!');
      process.exit(0);
    } else {
      console.log('⚠️  部分验证失败');
      process.exit(1);
    }
    
  } catch (err) {
    console.error('❌ 验证过程出错:', err.message);
    process.exit(1);
  }
}

// CLI 入口
if (require.main === module) {
  const args = process.argv.slice(2);
  let taskText = args.join(' ').trim();
  
  if (!taskText) {
    taskText = '先调研方案，然后实现 demo';
  }
  
  verify(taskText);
}

module.exports = { verify, verifyJsonStructure, verifySpawnInstruction, verifyTaskId };
