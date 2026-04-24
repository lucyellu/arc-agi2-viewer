import React, { useState, useEffect, useRef } from 'react';
import { Upload, Download, Image as ImageIcon, Archive, AlertCircle, CheckCircle2, ChevronRight, Play, Filter, AlertTriangle, XCircle, Trophy, Layers, BarChart2, TrendingDown, TrendingUp, Minus, Menu, Maximize2, Minimize2, Info, X, FileText, Copy, Check, ListTree } from 'lucide-react';

// ARC standard color palette
const ARC_COLORS = [
  "#000000", // 0: black
  "#0074D9", // 1: blue
  "#FF4136", // 2: red
  "#2ECC40", // 3: green
  "#FFDC00", // 4: yellow
  "#AAAAAA", // 5: grey
  "#F012BE", // 6: fuchsia
  "#FF851B", // 7: orange
  "#7FDBFF", // 8: teal
  "#870C25", // 9: brown
];

// Helper to detect if an attempt is just the default dummy [[0]]
const isDummyGrid = (grid) => {
  if (!grid || !Array.isArray(grid) || !Array.isArray(grid[0])) return true;
  if (grid.length === 1 && grid[0].length === 1 && grid[0][0] === 0) return true;
  return false;
};

// Helper for deep array equality (grid matching)
const gridsMatch = (g1, g2) => {
  if (!g1 || !g2 || !Array.isArray(g1) || !Array.isArray(g2)) return false;
  if (g1.length !== g2.length || g1[0].length !== g2[0].length) return false;
  for (let r = 0; r < g1.length; r++) {
    for (let c = 0; c < g1[0].length; c++) {
      if (g1[r][c] !== g2[r][c]) return false;
    }
  }
  return true;
};

// Helper to check if a grid is an exact copy of ANY test input in the task
const isCopiedInput = (grid, testData) => {
  if (!grid || !testData || !Array.isArray(testData)) return false;
  return testData.some(t => gridsMatch(grid, t.input));
};

// Helper to check if a submission array has at least one real attempt
const hasRealAttempt = (taskSubs, testData) => {
  if (!taskSubs) return false;
  return taskSubs.some(sub => {
    const a1Real = sub.attempt_1 && !isDummyGrid(sub.attempt_1) && !isCopiedInput(sub.attempt_1, testData);
    const a2Real = sub.attempt_2 && !isDummyGrid(sub.attempt_2) && !isCopiedInput(sub.attempt_2, testData);
    return a1Real || a2Real;
  });
};

// Calculate similarity metrics between a source grid and target expected grid
const getSimilarityStats = (source, target) => {
  if (!source || !target || !source[0] || !target[0]) return null;

  const rS = source.length;
  const cS = source[0].length;
  const rT = target.length;
  const cT = target[0].length;

  let matches = 0;
  const histS = Array(10).fill(0);
  const histT = Array(10).fill(0);

  for (let r = 0; r < rS; r++) {
    for (let c = 0; c < cS; c++) {
      histS[source[r][c]]++;
    }
  }
  for (let r = 0; r < rT; r++) {
    for (let c = 0; c < cT; c++) {
      histT[target[r][c]]++;
      if (r < rS && c < cS && source[r][c] === target[r][c]) {
        matches++;
      }
    }
  }

  const sourceArea = rS * cS;
  const targetArea = rT * cT;
  const maxArea = Math.max(sourceArea, targetArea);
  const similarityPct = (matches / maxArea) * 100;

  const colorDiffs = [];
  for(let i=0; i<10; i++) {
    if (histS[i] !== histT[i]) {
       // + means attempt is missing pixels compared to target, - means attempt has surplus
       colorDiffs.push({ color: i, diff: histT[i] - histS[i] });
    }
  }

  return {
    matches,
    sourceArea,
    targetArea,
    similarityPct,
    sizeMatch: rS === rT && cS === cT,
    colorDiffs
  };
};

const getExpectedOutput = (challenges, solutions, taskId, idx) => {
  if (challenges[taskId]?.test?.[idx]?.output) return challenges[taskId].test[idx].output;
  if (solutions[taskId]) {
    if (Array.isArray(solutions[taskId])) {
      const item = solutions[taskId][idx];
      if (!item) return null;
      if (Array.isArray(item) && (item.length === 0 || Array.isArray(item[0]))) return item;
      if (item.output) return item.output;
    }
    if (solutions[taskId].test?.[idx]?.output) return solutions[taskId].test[idx].output;
  }
  return null;
};

const getPairCount = (challenges, solutions, sub1, sub2, taskId) => {
  let count = challenges[taskId]?.test?.length || 0;
  if (count === 0 && sub1) count = Math.max(count, sub1.length);
  if (count === 0 && sub2) count = Math.max(count, sub2.length);
  if (count === 0 && solutions[taskId]) {
    if (Array.isArray(solutions[taskId])) count = Math.max(count, solutions[taskId].length);
    else if (solutions[taskId].test) count = Math.max(count, solutions[taskId].test.length);
  }
  return count;
};

// Extracts extra non-task metadata (like lora_r, augs, etc.) from a JSON object
const extractMetadata = (subObj) => {
  if (!subObj) return [];
  return Object.keys(subObj)
    .filter(k => !/^[0-9a-f]{8}$/i.test(k)) // Filter out task IDs (8 hex chars)
    .map(k => ({ key: k, value: subObj[k] }));
};

// Extract runtime/tokens per attempt
const formatItemMeta = (item) => {
  if (!item) return null;
  const parts = [];
  if (item.time_s !== undefined) parts.push(`${Number(item.time_s).toFixed(1)}s`);
  else if (item.time !== undefined) parts.push(`${Number(item.time).toFixed(1)}s`);
  else if (item.duration !== undefined) parts.push(`${Number(item.duration).toFixed(1)}s`);

  if (item.tokens !== undefined) parts.push(`${item.tokens} tok`);
  else if (item.prompt_tokens !== undefined || item.completion_tokens !== undefined) {
    const t = (item.prompt_tokens || 0) + (item.completion_tokens || 0);
    parts.push(`${t} tok`);
  }
  return parts.length ? parts.join(' | ') : null;
};

export default function App() {
  const [challenges, setChallenges] = useState({});
  const [solutions, setSolutions] = useState({});
  const [submission1, setSubmission1] = useState({});
  const [submission2, setSubmission2] = useState({});

  const [complexityData, setComplexityData] = useState(() => {
    try {
      const cached = localStorage.getItem('arcComplexityData');
      return cached ? JSON.parse(cached) : {};
    } catch (e) {
      return {};
    }
  });

  const [sub1Name, setSub1Name] = useState('');
  const [sub2Name, setSub2Name] = useState('');

  const [selectedTaskId, setSelectedTaskId] = useState(null);
  const [error, setError] = useState(null);
  const [isExporting, setIsExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState(0);
  const [jszipLoaded, setJszipLoaded] = useState(false);

  // Filter States
  const [filterRealAttempts, setFilterRealAttempts] = useState(false);
  const [filterWithSubmissions, setFilterWithSubmissions] = useState(false);
  const [filterSolvedSub1, setFilterSolvedSub1] = useState(false);
  const [filterSolvedSub2, setFilterSolvedSub2] = useState(false);
  const [filterMinSimilarity, setFilterMinSimilarity] = useState(false);
  const [minSimilarityThreshold, setMinSimilarityThreshold] = useState(85);
  const [disabledLevels, setDisabledLevels] = useState(new Set());
  const [disabledExampleCounts, setDisabledExampleCounts] = useState(new Set());

  // Viewing & Toggle States
  const [overlayMode, setOverlayMode] = useState(false);
  const [showSidebar, setShowSidebar] = useState(true);
  const [showFooter, setShowFooter] = useState(true);
  const [footerExpanded, setFooterExpanded] = useState(false);

  // Export Modal State
  const [showExportModal, setShowExportModal] = useState(false);
  const [copiedStates, setCopiedStates] = useState({});

  // Overlap Analysis State
  const [pivotRow, setPivotRow] = useState('level');
  const [pivotCol, setPivotCol] = useState('subproblems');

  const PIVOT_OPTIONS = {
    level: "Complexity Level",
    nExamples: "Train Examples (N)",
    subproblems: "Subproblems (Pairs)"
  };

  // Load defaults and external libraries
  useEffect(() => {
    const script = document.createElement('script');
    script.src = 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js';
    script.async = true;
    script.onload = () => setJszipLoaded(true);
    document.body.appendChild(script);

    // Auto-load default files if they are placed next to the index.html on server
    const autoLoadDefaults = async () => {
      try {
        const fetchFile = async (url) => {
          const res = await fetch(url);
          if (!res.ok) return null;
          return await res.json();
        };

        const chal = await fetchFile('arc-agi_evaluation_challenges.json');
        if (chal) {
          setChallenges(chal);
          const firstKey = Object.keys(chal).find(k => /^[0-9a-f]{8}$/i.test(k));
          if (firstKey) setSelectedTaskId(prev => prev || firstKey);
        }

        const sol = await fetchFile('arc-agi_evaluation_solutions.json');
        if (sol) setSolutions(sol);

        const comp = await fetchFile('complexity_analysis_20260405_035004.json');
        if (comp) {
          let puzzlesArray = [];
          if (Array.isArray(comp)) puzzlesArray = comp;
          else if (comp.puzzles && Array.isArray(comp.puzzles)) puzzlesArray = comp.puzzles;
          else {
             const arrKey = Object.keys(comp).find(k =>
                Array.isArray(comp[k]) && comp[k].length > 0 && comp[k][0] && typeof comp[k][0] === 'object' && 'id' in comp[k][0]
             );
             if (arrKey) puzzlesArray = comp[arrKey];
          }

          const compMap = {};
          puzzlesArray.forEach(p => {
             if (p.id) {
                 const levelKey = Object.keys(p).find(k => k.startsWith('level'));
                 let lvl = String(levelKey ? p[levelKey] : (p.complexity ?? 'Uncategorized'));
                 compMap[p.id] = { level: lvl, ...p };
             }
          });
          setComplexityData(compMap);
        }
      } catch (err) {
        console.log("No local default files found to load.");
      }
    };
    autoLoadDefaults();

    return () => document.body.removeChild(script);
  }, []);

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.code === 'Space' && e.target.tagName !== 'INPUT' && e.target.tagName !== 'TEXTAREA') {
        e.preventDefault();
        setOverlayMode(prev => !prev);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const handleFileUpload = (e, type) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const data = JSON.parse(event.target.result);
        if (type === 'challenges') {
          setChallenges(data);
          const firstKey = Object.keys(data).find(k => /^[0-9a-f]{8}$/i.test(k));
          if (firstKey && !selectedTaskId) setSelectedTaskId(firstKey);
        } else if (type === 'solutions') {
          setSolutions(data);
          const firstKey = Object.keys(data).find(k => /^[0-9a-f]{8}$/i.test(k));
          if (firstKey && !selectedTaskId) setSelectedTaskId(firstKey);
        } else if (type === 'sub1') {
          setSubmission1(data);
          setSub1Name(file.name);
          const firstKey = Object.keys(data).find(k => /^[0-9a-f]{8}$/i.test(k));
          if (firstKey && !selectedTaskId) setSelectedTaskId(firstKey);
        } else if (type === 'sub2') {
          setSubmission2(data);
          setSub2Name(file.name);
          const firstKey = Object.keys(data).find(k => /^[0-9a-f]{8}$/i.test(k));
          if (firstKey && !selectedTaskId) setSelectedTaskId(firstKey);
        } else if (type === 'analysis') {
          let puzzlesArray = [];
          if (Array.isArray(data)) puzzlesArray = data;
          else if (data.puzzles && Array.isArray(data.puzzles)) puzzlesArray = data.puzzles;
          else {
             // Fallback 1: Finding an array key
             const arrKey = Object.keys(data).find(k =>
                Array.isArray(data[k]) &&
                data[k].length > 0 &&
                data[k][0] &&
                typeof data[k][0] === 'object' &&
                'id' in data[k][0]
             );
             if (arrKey) {
                 puzzlesArray = data[arrKey];
             } else {
                 // Fallback 2: Check for v8 dictionary format { "taskId": { "task_id": "taskId", "level": 10 } }
                 const firstVal = Object.values(data)[0];
                 if (firstVal && typeof firstVal === 'object' && ('task_id' in firstVal || 'id' in firstVal)) {
                     puzzlesArray = Object.values(data).map(item => ({
                         ...item,
                         id: item.id || item.task_id
                     }));
                 }
             }
          }

          const compMap = {};
          puzzlesArray.forEach(p => {
             if (p.id) {
                 const levelKey = Object.keys(p).find(k => k.startsWith('level'));
                 let lvl = String(levelKey ? p[levelKey] : (p.complexity ?? 'Uncategorized'));
                 compMap[p.id] = { level: lvl, ...p };
             }
          });

          setComplexityData(compMap);
          localStorage.setItem('arcComplexityData', JSON.stringify(compMap));
        }
        setError(null);
      } catch (err) {
        setError(`Failed to parse ${type} JSON: ` + err.message);
      }
    };
    reader.readAsText(file);
  };

  const clearFile = (type) => {
    if (type === 'challenges') setChallenges({});
    if (type === 'solutions') setSolutions({});
    if (type === 'sub1') { setSubmission1({}); setSub1Name(''); }
    if (type === 'sub2') { setSubmission2({}); setSub2Name(''); }
    if (type === 'analysis') { setComplexityData({}); localStorage.removeItem('arcComplexityData'); }
  };

  const getTaskStatus = (taskId, sub) => {
    if (!sub) return null;
    let hasSolutions = false;
    let allPairsCorrect = true;

    const pairCount = getPairCount(challenges, solutions, submission1[taskId], submission2[taskId], taskId);

    for (let i = 0; i < pairCount; i++) {
      const expected = getExpectedOutput(challenges, solutions, taskId, i);
      if (!expected) continue;

      hasSolutions = true;
      const sPair = sub[i];
      if (!sPair) { allPairsCorrect = false; break; }

      const isCorrect = gridsMatch(sPair.attempt_1, expected) || gridsMatch(sPair.attempt_2, expected);
      if (!isCorrect) { allPairsCorrect = false; break; }
    }

    return hasSolutions ? allPairsCorrect : null;
  };

  const getTaskBestSimilarity = (taskId) => {
    let bestSim = -1;
    const pCount = getPairCount(challenges, solutions, submission1[taskId], submission2[taskId], taskId);
    for (let i = 0; i < pCount; i++) {
      const expected = getExpectedOutput(challenges, solutions, taskId, i);
      if (!expected) continue;

      [submission1[taskId], submission2[taskId]].forEach(sub => {
          if (sub && sub[i]) {
              const sPair = sub[i];
              [sPair.attempt_1, sPair.attempt_2].forEach(attempt => {
                  if (attempt && !isDummyGrid(attempt)) {
                      const stats = getSimilarityStats(attempt, expected);
                      if (stats && stats.similarityPct > bestSim) {
                          bestSim = stats.similarityPct;
                      }
                  }
              });
          }
      });
    }
    return bestSim;
  };

  const allTaskIds = Array.from(new Set([
    ...Object.keys(challenges).filter(k => /^[0-9a-f]{8}$/i.test(k)),
    ...Object.keys(solutions).filter(k => /^[0-9a-f]{8}$/i.test(k)),
    ...Object.keys(submission1).filter(k => /^[0-9a-f]{8}$/i.test(k)),
    ...Object.keys(submission2).filter(k => /^[0-9a-f]{8}$/i.test(k))
  ])).sort();

  const hasAnalysis = Object.keys(complexityData).length > 0;

  const activeLevelsSet = new Set();
  const activeExampleCountsSet = new Set();

  allTaskIds.forEach(id => {
    if (hasAnalysis && complexityData[id]) activeLevelsSet.add(complexityData[id].level);
    if (challenges[id]?.train) activeExampleCountsSet.add(challenges[id].train.length);
  });

  const activeLevelsArray = Array.from(activeLevelsSet).sort((a,b) => a.toString().localeCompare(b.toString(), undefined, {numeric: true}));
  const activeExampleCountsArray = Array.from(activeExampleCountsSet).sort((a,b) => a - b);

  // 1. FILTERING
  const displayIds = allTaskIds.filter(taskId => {
    const hasChallenge = !!challenges[taskId];
    const hasSub1 = !!submission1[taskId];
    const hasSub2 = !!submission2[taskId];
    const hasSub = hasSub1 || hasSub2;

    const testData = challenges[taskId]?.test;
    const isReal = hasRealAttempt(submission1[taskId], testData) || hasRealAttempt(submission2[taskId], testData);

    const s1Status = getTaskStatus(taskId, submission1[taskId]);
    const s2Status = getTaskStatus(taskId, submission2[taskId]);

    if (filterRealAttempts && !isReal) return false;
    if (filterWithSubmissions && !hasSub) return false;
    if (filterSolvedSub1 && !s1Status) return false;
    if (filterSolvedSub2 && !s2Status) return false;

    if (filterMinSimilarity) {
      const bestSim = getTaskBestSimilarity(taskId);
      if (bestSim < minSimilarityThreshold) return false;
    }

    if (hasAnalysis) {
      const lvl = complexityData[taskId]?.level ?? 'Uncategorized';
      if (disabledLevels.has(lvl)) return false;
    }

    if (hasChallenge && challenges[taskId]?.train) {
      const nExamples = challenges[taskId].train.length;
      if (disabledExampleCounts.has(nExamples)) return false;
    }

    return true;
  });

  const hasSub1File = Object.keys(submission1).length > 0;
  const hasSub2File = Object.keys(submission2).length > 0;

  const s1MetaInfo = extractMetadata(submission1);
  const s2MetaInfo = extractMetadata(submission2);

  // 2. STATS ACCUMULATION (Calculated over displayIds to mirror active filters)
  const stats = {
      overall: { total: 0, evaluated: 0, s1Correct: 0, s2Correct: 0, s1RealCount: 0, s2RealCount: 0, s1RealCorrect: 0, s2RealCorrect: 0, s1SimSum: 0, s1Count: 0, s2SimSum: 0, s2Count: 0 },
      byLevel: {},
      byNExamples: {},
      bySubproblems: {}
  };

  displayIds.forEach(taskId => {
      const pCount = getPairCount(challenges, solutions, submission1[taskId], submission2[taskId], taskId);
      const nExamples = challenges[taskId]?.train?.length ?? 'Unknown';
      const nSubproblems = pCount > 0 ? String(pCount) : 'Unknown';

      let taskHasGroundTruth = false;
      let taskS1Correct = true;
      let taskS2Correct = true;
      let taskS1HasAttempt = false;
      let taskS2HasAttempt = false;

      let taskS1BestSimSum = 0;
      let taskS2BestSimSum = 0;
      let taskPairsWithTruth = 0;

      for(let i=0; i<pCount; i++) {
          const expected = getExpectedOutput(challenges, solutions, taskId, i);
          if (!expected) continue;

          taskHasGroundTruth = true;
          taskPairsWithTruth++;

          if (hasSub1File && submission1[taskId]) {
              const sPair = submission1[taskId][i];
              if (sPair) {
                  taskS1HasAttempt = true;
                  const isCorrect = gridsMatch(sPair.attempt_1, expected) || gridsMatch(sPair.attempt_2, expected);
                  if (!isCorrect) taskS1Correct = false;

                  const diff1 = sPair.attempt_1 && !isDummyGrid(sPair.attempt_1) ? getSimilarityStats(sPair.attempt_1, expected) : null;
                  const diff2 = sPair.attempt_2 && !isDummyGrid(sPair.attempt_2) ? getSimilarityStats(sPair.attempt_2, expected) : null;

                  let bestSim = null;
                  if (diff1) bestSim = diff1.similarityPct;
                  if (diff2) bestSim = bestSim !== null ? Math.max(bestSim, diff2.similarityPct) : diff2.similarityPct;

                  if (bestSim !== null) {
                      taskS1BestSimSum += bestSim;
                  }
              } else {
                  taskS1Correct = false;
              }
          } else {
              taskS1Correct = false;
          }

          if (hasSub2File && submission2[taskId]) {
              const sPair = submission2[taskId][i];
              if (sPair) {
                  taskS2HasAttempt = true;
                  const isCorrect = gridsMatch(sPair.attempt_1, expected) || gridsMatch(sPair.attempt_2, expected);
                  if (!isCorrect) taskS2Correct = false;

                  const diff1 = sPair.attempt_1 && !isDummyGrid(sPair.attempt_1) ? getSimilarityStats(sPair.attempt_1, expected) : null;
                  const diff2 = sPair.attempt_2 && !isDummyGrid(sPair.attempt_2) ? getSimilarityStats(sPair.attempt_2, expected) : null;

                  let bestSim = null;
                  if (diff1) bestSim = diff1.similarityPct;
                  if (diff2) bestSim = bestSim !== null ? Math.max(bestSim, diff2.similarityPct) : diff2.similarityPct;

                  if (bestSim !== null) {
                      taskS2BestSimSum += bestSim;
                  }
              } else {
                  taskS2Correct = false;
              }
          } else {
              taskS2Correct = false;
          }
      }

      const level = hasAnalysis ? (complexityData[taskId]?.level ?? 'Uncategorized') : 'Uncategorized';
      const s1IsReal = hasRealAttempt(submission1[taskId], challenges[taskId]?.test);
      const s2IsReal = hasRealAttempt(submission2[taskId], challenges[taskId]?.test);

      const initStatsNode = () => ({ total: 0, evaluated: 0, s1Correct: 0, s2Correct: 0, s1RealCount: 0, s2RealCount: 0, s1RealCorrect: 0, s2RealCorrect: 0, s1SimSum: 0, s1Count: 0, s2SimSum: 0, s2Count: 0 });

      if (!stats.byLevel[level]) stats.byLevel[level] = initStatsNode();
      if (!stats.byNExamples[nExamples]) stats.byNExamples[nExamples] = initStatsNode();
      if (!stats.bySubproblems[nSubproblems]) stats.bySubproblems[nSubproblems] = initStatsNode();

      const updateStats = (node) => {
          node.total++;

          if (taskHasGroundTruth) {
              node.evaluated++;
              if (hasSub1File) {
                  if (taskS1Correct) node.s1Correct++;
                  if (s1IsReal) {
                      node.s1RealCount++;
                      if (taskS1Correct) node.s1RealCorrect++;
                  }
                  if (taskS1HasAttempt) {
                      node.s1Count++;
                      node.s1SimSum += (taskS1BestSimSum / taskPairsWithTruth);
                  }
              }

              if (hasSub2File) {
                  if (taskS2Correct) node.s2Correct++;
                  if (s2IsReal) {
                      node.s2RealCount++;
                      if (taskS2Correct) node.s2RealCorrect++;
                  }
                  if (taskS2HasAttempt) {
                      node.s2Count++;
                      node.s2SimSum += (taskS2BestSimSum / taskPairsWithTruth);
                  }
              }
          }
      };

      updateStats(stats.overall);
      updateStats(stats.byLevel[level]);
      updateStats(stats.byNExamples[nExamples]);
      updateStats(stats.bySubproblems[nSubproblems]);
  });

  const mismatchedSubsCount = new Set([
    ...Object.keys(submission1).filter(id => !challenges[id] && !solutions[id] && /^[0-9a-f]{8}$/i.test(id)),
    ...Object.keys(submission2).filter(id => !challenges[id] && !solutions[id] && /^[0-9a-f]{8}$/i.test(id))
  ]).size;

  // 3. OVERLAP PIVOT CALCULATION
  const getPivotValue = (taskId, key) => {
    if (key === 'level') return hasAnalysis ? (complexityData[taskId]?.level ?? 'Uncategorized') : 'Uncategorized';
    if (key === 'nExamples') return challenges[taskId]?.train?.length ?? 'Unknown';
    if (key === 'subproblems') {
       const pCount = getPairCount(challenges, solutions, submission1[taskId], submission2[taskId], taskId);
       return pCount > 0 ? String(pCount) : 'Unknown';
    }
    return 'Unknown';
  };

  const pivotData = {};
  const rowKeys = new Set();
  const colKeys = new Set();

  displayIds.forEach(taskId => {
      const rVal = String(getPivotValue(taskId, pivotRow));
      const cVal = String(getPivotValue(taskId, pivotCol));
      rowKeys.add(rVal);
      colKeys.add(cVal);

      if (!pivotData[rVal]) pivotData[rVal] = {};
      if (!pivotData[rVal][cVal]) pivotData[rVal][cVal] = 0;
      pivotData[rVal][cVal]++;
  });

  const sortedRowKeys = Array.from(rowKeys).sort((a,b) => a==='Unknown'?1:b==='Unknown'?-1:a.localeCompare(b, undefined, {numeric: true}));
  const sortedColKeys = Array.from(colKeys).sort((a,b) => a==='Unknown'?1:b==='Unknown'?-1:a.localeCompare(b, undefined, {numeric: true}));

  // 4. EXPORT & CANVAS RENDERING
  const drawTaskToCanvas = (taskId, task, sub1, sub2, taskIndex) => {
    return new Promise((resolve) => {
      const CELL_SIZE = 24;
      const PADDING = 30;
      const HEADER_HEIGHT = 60;
      const GRID_PADDING = 15;
      const LABEL_HEIGHT = 24;
      const ROW_SPACING = 40;

      let totalHeight = HEADER_HEIGHT + PADDING;
      let maxWidth = 400;

      const getGridDim = (grid) => {
        if (!grid || !Array.isArray(grid) || !Array.isArray(grid[0])) return { w: 0, h: 0 };
        return { w: grid[0].length * CELL_SIZE, h: grid.length * CELL_SIZE };
      };

      const rows = [];

      if (task && task.train) {
        task.train.forEach((pair, i) => {
          rows.push({
            title: `Training Pair ${i + 1}`,
            items: [
              { label: 'Train Problem', grid: pair.input, type: 'neutral' },
              { label: 'Train Solution', grid: pair.output, type: 'neutral' }
            ]
          });
        });
      }

      const pairCount = getPairCount(challenges, solutions, sub1, sub2, taskId);

      for (let i = 0; i < pairCount; i++) {
        const inputGrid = task?.test?.[i]?.input;
        const expected = getExpectedOutput(challenges, solutions, taskId, i);
        const s1 = sub1 ? sub1[i] : null;
        const s2 = sub2 ? sub2[i] : null;

        const items = [];
        if (inputGrid) items.push({ label: 'Evaluation Problem', grid: inputGrid, type: 'neutral' });
        if (expected) items.push({ label: 'Evaluation Solution', grid: expected, type: 'expected' });

        if (s1 && s1.attempt_1) items.push({
          label: 'Sub 1: Attempt 1',
          grid: s1.attempt_1,
          type: expected ? (gridsMatch(s1.attempt_1, expected) ? 'pass' : 'fail') : 'neutral'
        });
        if (s1 && s1.attempt_2) items.push({
          label: 'Sub 1: Attempt 2',
          grid: s1.attempt_2,
          type: expected ? (gridsMatch(s1.attempt_2, expected) ? 'pass' : 'fail') : 'neutral'
        });

        if (s2 && s2.attempt_1) items.push({
          label: 'Sub 2: Attempt 1',
          grid: s2.attempt_1,
          type: expected ? (gridsMatch(s2.attempt_1, expected) ? 'pass' : 'fail') : 'neutral'
        });
        if (s2 && s2.attempt_2) items.push({
          label: 'Sub 2: Attempt 2',
          grid: s2.attempt_2,
          type: expected ? (gridsMatch(s2.attempt_2, expected) ? 'pass' : 'fail') : 'neutral'
        });

        if (items.length > 0) {
          rows.push({ title: `Evaluation Pair ${i + 1}`, items, isTest: true });
        }
      }

      const layoutRows = [];
      for (const row of rows) {
        let rowHeight = 0;
        let rowWidth = PADDING;
        const itemsLayout = [];

        for (const item of row.items) {
          const dim = getGridDim(item.grid);
          const itemHeight = dim.h + LABEL_HEIGHT + GRID_PADDING;
          const itemWidth = dim.w;

          if (itemHeight > rowHeight) rowHeight = itemHeight;

          itemsLayout.push({ ...item, x: rowWidth, y: 0, w: itemWidth, h: dim.h });
          rowWidth += itemWidth + PADDING * 1.5;
        }

        if (rowWidth > maxWidth) maxWidth = rowWidth;
        layoutRows.push({ ...row, items: itemsLayout, height: rowHeight + LABEL_HEIGHT * 2, y: totalHeight });
        totalHeight += rowHeight + LABEL_HEIGHT * 2 + ROW_SPACING;
      }

      const canvas = document.createElement('canvas');
      canvas.width = maxWidth;
      canvas.height = totalHeight;
      const ctx = canvas.getContext('2d');

      ctx.fillStyle = '#121212';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 24px Inter, system-ui, sans-serif';
      ctx.fillText(`ARC Task ${taskIndex}: ${taskId}`, PADDING, 35);

      for (const row of layoutRows) {
        ctx.fillStyle = row.isTest ? '#FACC15' : '#60A5FA';
        ctx.font = 'bold 16px Inter, system-ui, sans-serif';
        ctx.fillText(row.title, PADDING, row.y);

        for (const item of row.items) {
          const startX = item.x;
          const startY = row.y + 10;

          let labelText = item.label;
          if (item.type === 'pass') {
            ctx.fillStyle = '#4ADE80';
            labelText = `✔ ${item.label}`;
          } else if (item.type === 'expected') {
            ctx.fillStyle = '#4ADE80';
          } else if (item.type === 'fail') {
            ctx.fillStyle = '#F87171';
            labelText = `✘ ${item.label}`;
          } else {
            ctx.fillStyle = '#E5E5E5';
          }

          ctx.font = '12px Inter, system-ui, sans-serif';
          ctx.fillText(labelText, startX, startY + 12);

          const gridY = startY + 20;

          if (item.w > 0 && item.h > 0) {
            if (item.type === 'pass' || item.type === 'expected') {
              ctx.fillStyle = '#22c55e';
              ctx.fillRect(startX - 2, gridY - 2, item.w + 4, item.h + 4);
            } else if (item.type === 'fail') {
              ctx.fillStyle = '#ef4444';
              ctx.fillRect(startX - 2, gridY - 2, item.w + 4, item.h + 4);
            } else {
              ctx.fillStyle = '#333333';
              ctx.fillRect(startX, gridY, item.w + 2, item.h + 2);
            }

            for (let r = 0; r < item.grid.length; r++) {
              for (let c = 0; c < item.grid[r].length; c++) {
                const val = item.grid[r][c];
                ctx.fillStyle = ARC_COLORS[val] || '#000000';
                const borderOffset = (item.type === 'pass' || item.type === 'fail' || item.type === 'expected') ? -1 : 1;
                ctx.fillRect(startX + borderOffset + c * CELL_SIZE, gridY + borderOffset + r * CELL_SIZE, CELL_SIZE - 1, CELL_SIZE - 1);
              }
            }
          } else {
            ctx.fillStyle = '#EF4444';
            ctx.fillText("Invalid Grid", startX, gridY + 15);
          }
        }
      }

      resolve(canvas.toDataURL('image/png'));
    });
  };

  const exportCurrentTask = async () => {
    if (!selectedTaskId) return;
    setIsExporting(true);
    const taskIndex = allTaskIds.indexOf(selectedTaskId) + 1;
    const dataUrl = await drawTaskToCanvas(selectedTaskId, challenges[selectedTaskId], submission1[selectedTaskId], submission2[selectedTaskId], taskIndex);
    const a = document.createElement("a");
    a.href = dataUrl;
    a.download = `ARC_${selectedTaskId}.png`;
    a.click();
    setIsExporting(false);
  };

  const exportWorkspaceToZip = async () => {
    if (!jszipLoaded || !window.JSZip) {
      setError("ZIP library is not loaded yet. Please wait a moment and try again.");
      return;
    }

    setIsExporting(true);
    setExportProgress(0);

    try {
      const zip = new window.JSZip();

      // 1. Export uploaded JSON files
      if (Object.keys(challenges).length > 0) zip.file("challenges.json", JSON.stringify(challenges, null, 2));
      if (Object.keys(solutions).length > 0) zip.file("solutions.json", JSON.stringify(solutions, null, 2));
      if (hasSub1File) zip.file(sub1Name || "submission_1.json", JSON.stringify(submission1, null, 2));
      if (hasSub2File) zip.file(sub2Name || "submission_2.json", JSON.stringify(submission2, null, 2));
      if (Object.keys(complexityData).length > 0) zip.file("complexity_analysis.json", JSON.stringify(complexityData, null, 2));

      // 2. Export generated stats (Includes active filters and overlap analysis)
      const exportStats = {
         ...stats,
         overlapAnalysis: {
            rowProperty: pivotRow,
            colProperty: pivotCol,
            data: pivotData
         }
      };
      zip.file("stats.json", JSON.stringify(exportStats, null, 2));

      // 3. Export Filtered Task IDs
      const idsFolder = zip.folder("task_ids");
      if (hasSub1File) {
         idsFolder.file("sub1_right.txt", formatIdsAsKaggleArray(getFilteredIds(1, true)));
         idsFolder.file("sub1_wrong.txt", formatIdsAsKaggleArray(getFilteredIds(1, false)));
      }
      if (hasSub2File) {
         idsFolder.file("sub2_right.txt", formatIdsAsKaggleArray(getFilteredIds(2, true)));
         idsFolder.file("sub2_wrong.txt", formatIdsAsKaggleArray(getFilteredIds(2, false)));
      }

      // 4. Export Visualizations for currently filtered tasks
      const visFolder = zip.folder("visualizations");
      for (let i = 0; i < displayIds.length; i++) {
        const taskId = displayIds[i];
        const taskIndex = allTaskIds.indexOf(taskId) + 1;
        const dataUrl = await drawTaskToCanvas(taskId, challenges[taskId], submission1[taskId], submission2[taskId], taskIndex);
        const base64 = dataUrl.split(',')[1];
        visFolder.file(`${taskId}.png`, base64, { base64: true });
        setExportProgress(Math.round(((i + 1) / displayIds.length) * 100));
      }

      const content = await zip.generateAsync({ type: "blob" });
      const url = URL.createObjectURL(content);
      const a = document.createElement("a");
      a.href = url;
      a.download = "arc_workspace_export.zip";
      a.click();
    } catch (err) {
      setError("Failed to export workspace: " + err.message);
    }

    setIsExporting(false);
    setExportProgress(0);
  };

  const getFilteredIds = (subNum, isCorrect) => {
    const subData = subNum === 1 ? submission1 : submission2;
    if (!subData || Object.keys(subData).length === 0) return [];

    const result = [];
    displayIds.forEach(taskId => {
        // Only evaluate tasks where a ground truth exists
        let hasTruth = false;
        const pCount = getPairCount(challenges, solutions, submission1[taskId], submission2[taskId], taskId);
        for (let i = 0; i < pCount; i++) {
            if (getExpectedOutput(challenges, solutions, taskId, i)) {
                hasTruth = true;
                break;
            }
        }
        if (!hasTruth) return;

        const status = getTaskStatus(taskId, subData[taskId]);
        if (isCorrect && status === true) result.push(taskId);
        if (!isCorrect && status === false) result.push(taskId);
    });
    return result;
  };

  const formatIdsAsKaggleArray = (ids) => {
    return JSON.stringify(ids).replace(/,/g, ', ');
  };

  const copyToClipboard = (text, key) => {
    const textArea = document.createElement("textarea");
    textArea.value = text;
    document.body.appendChild(textArea);
    textArea.select();
    try {
      document.execCommand('copy');
      setCopiedStates(prev => ({ ...prev, [key]: true }));
      setTimeout(() => setCopiedStates(prev => ({ ...prev, [key]: false })), 2000);
    } catch (err) {
      console.error('Failed to copy text: ', err);
    }
    document.body.removeChild(textArea);
  };

  const downloadTextFile = (text, filename) => {
    const blob = new Blob([text], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  const renderExportCard = (title, ids, subNum, typeKey) => {
    const textStr = formatIdsAsKaggleArray(ids);
    const copyKey = `sub${subNum}_${typeKey}`;

    return (
      <div className="bg-neutral-800/50 p-4 rounded-xl border border-neutral-700/50 flex flex-col gap-3">
         <div className="flex justify-between items-center">
            <h4 className="text-sm font-bold text-neutral-200">
               {title} <span className="ml-2 text-xs text-neutral-500 font-normal">({ids.length} tasks)</span>
            </h4>
            <div className="flex items-center gap-2">
               <button
                 onClick={() => copyToClipboard(textStr, copyKey)}
                 className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${copiedStates[copyKey] ? 'bg-green-600/20 text-green-400 border border-green-500/30' : 'bg-neutral-700 hover:bg-neutral-600 text-neutral-200'}`}
               >
                 {copiedStates[copyKey] ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                 {copiedStates[copyKey] ? 'Copied!' : 'Copy'}
               </button>
               <button
                 onClick={() => downloadTextFile(textStr, `arc_${copyKey}_tasks.txt`)}
                 className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600/20 text-blue-400 hover:bg-blue-600/30 border border-blue-500/30 rounded-md text-xs font-medium transition-colors"
               >
                 <Download className="w-3.5 h-3.5" />
                 TXT
               </button>
            </div>
         </div>
         <textarea
            readOnly
            value={textStr}
            className="w-full bg-neutral-900 border border-neutral-800 rounded-lg p-3 text-xs font-mono text-neutral-400 h-24 custom-scrollbar focus:outline-none focus:border-blue-500/50"
         />
      </div>
    );
  };

  const renderScoreAndError = (node, subNum, useReal) => {
    const isS1 = subNum === 1;
    if (node.evaluated === 0) return <span className="text-neutral-600 text-[10px] italic">Unscored</span>;

    const denominator = useReal ? (isS1 ? node.s1RealCount : node.s2RealCount) : node.evaluated;
    const correct = useReal ? (isS1 ? node.s1RealCorrect : node.s2RealCorrect) : (isS1 ? node.s1Correct : node.s2Correct);

    const simSum = isS1 ? node.s1SimSum : node.s2SimSum;
    const count = isS1 ? node.s1Count : node.s2Count;

    if (denominator === 0 && count === 0) return <span className="text-neutral-600">-</span>;
    if (useReal && denominator === 0) return <span className="text-neutral-500 text-[10px] italic">No real attempts</span>;

    const wrong = denominator - correct;
    const acc = ((correct / denominator) * 100).toFixed(1);
    const avgSim = count > 0 ? (simSum / count).toFixed(1) : 0;

    return (
        <div className="flex flex-col gap-0.5 my-1">
            <div className="flex items-center gap-1.5 whitespace-nowrap">
                <span className="text-green-400 font-medium">{correct} ✓</span>
                <span className="text-neutral-600">·</span>
                <span className="text-red-400">{wrong} ✗</span>
                <span className="text-neutral-500 text-[10px] ml-1 mr-2">/ {denominator}</span>
                <span className="text-blue-400 font-bold">{acc}% <span className="text-[9px] font-normal text-neutral-400 uppercase tracking-wider">acc</span></span>
            </div>
            <div className="flex items-center text-[10px]">
                <span className="text-neutral-500">Avg Similarity:</span>
                <span className={`ml-1 font-bold ${avgSim >= 99 ? 'text-green-400' : avgSim >= 50 ? 'text-yellow-400' : 'text-red-400'}`}>{avgSim}%</span>
            </div>
        </div>
    );
  };

  return (
    <div className="flex h-screen w-full bg-neutral-900 text-neutral-100 font-sans overflow-hidden">

      {/* Export Modal Overlay */}
      {showExportModal && (
        <div className="absolute inset-0 z-[100] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-neutral-900 border border-neutral-700 rounded-xl shadow-2xl max-w-3xl w-full flex flex-col max-h-[90vh]">
            <div className="p-4 border-b border-neutral-800 flex justify-between items-center shrink-0">
              <h3 className="text-lg font-bold text-white flex items-center gap-2">
                 <FileText className="w-5 h-5 text-blue-400" /> Export Evaluated Task IDs
              </h3>
              <button onClick={() => setShowExportModal(false)} className="text-neutral-400 hover:text-white transition-colors">
                 <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-6 overflow-y-auto custom-scrollbar space-y-8">
               <p className="text-xs text-neutral-400 leading-relaxed -mt-2">
                 These Python-ready lists are formatted to exactly replace cell arrays like <code className="bg-neutral-800 px-1 py-0.5 rounded text-yellow-400">["0934a4d8", "36a08778"]</code> in Kaggle scripts. Only tasks with a ground truth evaluation are included. These lists match your active side-panel filters.
               </p>

               {hasSub1File && (
                 <div className="space-y-4">
                    <h3 className="text-yellow-500 font-bold uppercase tracking-wider text-sm flex items-center gap-2">
                       <span className="w-2 h-2 rounded-full bg-yellow-500"></span> Submission 1 {sub1Name ? `(${sub1Name})` : ''}
                    </h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                       {renderExportCard("Right Problems (Passed)", getFilteredIds(1, true), 1, "right")}
                       {renderExportCard("Wrong Problems (Failed)", getFilteredIds(1, false), 1, "wrong")}
                    </div>
                 </div>
               )}

               {hasSub2File && (
                 <div className="space-y-4 pt-4 border-t border-neutral-800">
                    <h3 className="text-teal-500 font-bold uppercase tracking-wider text-sm flex items-center gap-2">
                       <span className="w-2 h-2 rounded-full bg-teal-500"></span> Submission 2 {sub2Name ? `(${sub2Name})` : ''}
                    </h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                       {renderExportCard("Right Problems (Passed)", getFilteredIds(2, true), 2, "right")}
                       {renderExportCard("Wrong Problems (Failed)", getFilteredIds(2, false), 2, "wrong")}
                    </div>
                 </div>
               )}

               {!hasSub1File && !hasSub2File && (
                 <div className="text-center py-12 text-neutral-500 flex flex-col items-center gap-3 border border-neutral-800 border-dashed rounded-xl">
                    <AlertCircle className="w-8 h-8 opacity-50" />
                    <p>Upload Submission 1 or 2 first to export evaluated task IDs.</p>
                 </div>
               )}
            </div>
          </div>
        </div>
      )}

      {/* Sidebar */}
      {showSidebar && (
        <div className="w-[340px] bg-neutral-950 border-r border-neutral-800 flex flex-col h-full shrink-0 z-30 relative">
          <div className="p-4 border-b border-neutral-800 space-y-4 shrink-0 overflow-y-auto max-h-[100vh] custom-scrollbar">
            <h1 className="text-xl font-bold text-white flex items-center gap-2">
              <Play className="w-5 h-5 text-blue-500" /> ARC Viewer
            </h1>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="flex justify-between items-center text-[10px] font-bold text-neutral-500 mb-1 uppercase tracking-wider">
                  Challenges
                  {Object.keys(challenges).length > 0 && <X className="w-3 h-3 cursor-pointer hover:text-red-400" onClick={() => clearFile('challenges')} title="Clear file" />}
                </label>
                <label className="flex items-center justify-center w-full p-2 border border-dashed border-neutral-700 rounded-lg cursor-pointer hover:border-blue-500 hover:bg-blue-500/10 transition-colors">
                  <Upload className="w-3 h-3 mr-1.5 text-blue-400" />
                  <span className="text-[10px] truncate">{Object.keys(challenges).length > 0 ? `${Object.keys(challenges).length} loaded` : 'Upload'}</span>
                  <input type="file" accept=".json" className="hidden" onChange={(e) => handleFileUpload(e, 'challenges')} />
                </label>
              </div>
              <div>
                <label className="flex justify-between items-center text-[10px] font-bold text-neutral-500 mb-1 uppercase tracking-wider">
                  Solutions
                  {Object.keys(solutions).length > 0 && <X className="w-3 h-3 cursor-pointer hover:text-red-400" onClick={() => clearFile('solutions')} title="Clear file" />}
                </label>
                <label className="flex items-center justify-center w-full p-2 border border-dashed border-neutral-700 rounded-lg cursor-pointer hover:border-purple-500 hover:bg-purple-500/10 transition-colors">
                  <Upload className="w-3 h-3 mr-1.5 text-purple-400" />
                  <span className="text-[10px] truncate">{Object.keys(solutions).length > 0 ? `${Object.keys(solutions).length} loaded` : 'Upload'}</span>
                  <input type="file" accept=".json" className="hidden" onChange={(e) => handleFileUpload(e, 'solutions')} />
                </label>
              </div>
              <div>
                <label className="flex justify-between items-center text-[10px] font-bold text-neutral-500 mb-1 uppercase tracking-wider">
                  Sub 1
                  {hasSub1File && <X className="w-3 h-3 cursor-pointer hover:text-red-400" onClick={() => clearFile('sub1')} title="Clear file" />}
                </label>
                <label className="flex items-center justify-center w-full p-2 border border-dashed border-neutral-700 rounded-lg cursor-pointer hover:border-yellow-500 hover:bg-yellow-500/10 transition-colors" title={sub1Name}>
                  <Upload className="w-3 h-3 mr-1.5 text-yellow-500" />
                  <span className="text-[10px] truncate">{hasSub1File ? 'Loaded' : 'Upload'}</span>
                  <input type="file" accept=".json" className="hidden" onChange={(e) => handleFileUpload(e, 'sub1')} />
                </label>
              </div>
              <div>
                <label className="flex justify-between items-center text-[10px] font-bold text-neutral-500 mb-1 uppercase tracking-wider">
                  Sub 2
                  {hasSub2File && <X className="w-3 h-3 cursor-pointer hover:text-red-400" onClick={() => clearFile('sub2')} title="Clear file" />}
                </label>
                <label className="flex items-center justify-center w-full p-2 border border-dashed border-neutral-700 rounded-lg cursor-pointer hover:border-teal-500 hover:bg-teal-500/10 transition-colors" title={sub2Name}>
                  <Upload className="w-3 h-3 mr-1.5 text-teal-500" />
                  <span className="text-[10px] truncate">{hasSub2File ? 'Loaded' : 'Upload'}</span>
                  <input type="file" accept=".json" className="hidden" onChange={(e) => handleFileUpload(e, 'sub2')} />
                </label>
              </div>
            </div>

            {/* Filters & Viewing */}
            <div className="space-y-2 mt-4 pt-4 border-t border-neutral-800">
              <h3 className="text-[11px] font-bold text-neutral-400 uppercase tracking-wider flex items-center gap-1">
                <Filter className="w-3 h-3" /> Filters & Viewing
              </h3>

              <div className="grid grid-cols-2 gap-x-2 gap-y-2 mb-2">
                <label className="flex items-center gap-1.5 text-[11px] text-neutral-300 cursor-pointer hover:text-white">
                  <input type="checkbox" checked={filterWithSubmissions} onChange={(e) => setFilterWithSubmissions(e.target.checked)} className="rounded border-neutral-700 bg-neutral-800 text-blue-500 focus:ring-blue-500" />
                  Has Submissions
                </label>
                <label className="flex items-center gap-1.5 text-[11px] text-neutral-300 cursor-pointer hover:text-white" title="Ignores copied inputs and [[0]] grids">
                  <input type="checkbox" checked={filterRealAttempts} onChange={(e) => setFilterRealAttempts(e.target.checked)} className="rounded border-neutral-700 bg-neutral-800 text-yellow-500 focus:ring-yellow-500" />
                  Real Attempts Only
                </label>
                {(hasSub1File || hasSub2File) && (
                  <>
                    <label className="flex items-center gap-1.5 text-[11px] text-neutral-300 cursor-pointer hover:text-white">
                      <input type="checkbox" checked={filterSolvedSub1} onChange={(e) => setFilterSolvedSub1(e.target.checked)} className="rounded border-neutral-700 bg-neutral-800 text-green-500 focus:ring-green-500" />
                      S1 Solved Only
                    </label>
                    <label className="flex items-center gap-1.5 text-[11px] text-neutral-300 cursor-pointer hover:text-white">
                      <input type="checkbox" checked={filterSolvedSub2} onChange={(e) => setFilterSolvedSub2(e.target.checked)} className="rounded border-neutral-700 bg-neutral-800 text-green-500 focus:ring-green-500" />
                      S2 Solved Only
                    </label>
                  </>
                )}
              </div>

              {/* Custom Similarity Filter */}
              <div className="flex items-center justify-between mb-2">
                <label className="flex items-center gap-1.5 text-[11px] text-neutral-300 cursor-pointer hover:text-white" title="Filter tasks where at least one attempt meets this similarity percentage">
                  <input type="checkbox" checked={filterMinSimilarity} onChange={(e) => setFilterMinSimilarity(e.target.checked)} className="rounded border-neutral-700 bg-neutral-800 text-blue-500 focus:ring-blue-500" />
                  Sim. Threshold &gt;=
                </label>
                <div className="flex items-center gap-1">
                  <input
                    type="number"
                    min="0"
                    max="100"
                    value={minSimilarityThreshold}
                    onChange={(e) => setMinSimilarityThreshold(Number(e.target.value))}
                    disabled={!filterMinSimilarity}
                    className="w-12 px-1 py-0.5 text-[10px] bg-neutral-950 border border-neutral-700 rounded text-white focus:outline-none focus:border-blue-500 disabled:opacity-50 text-right"
                  />
                  <span className="text-[10px] text-neutral-500 font-bold">%</span>
                </div>
              </div>

              {/* Dynamic Level Filters */}
              <div className="pt-2 border-t border-neutral-800/50">
                <div className="flex items-center justify-between mb-2">
                  <label className="text-[11px] font-bold text-pink-400 uppercase tracking-wider flex items-center gap-1">
                     Level Filter
                     {hasAnalysis && <X className="w-3 h-3 ml-1 cursor-pointer hover:text-red-400 text-neutral-500" onClick={() => clearFile('analysis')} title="Clear file" />}
                  </label>
                  <div className="flex gap-2 items-center">
                    {activeLevelsArray.length > 0 && (
                      <button className="text-[9px] text-neutral-400 hover:text-white transition-colors" onClick={() => {
                          if (disabledLevels.size === 0) setDisabledLevels(new Set(activeLevelsArray));
                          else setDisabledLevels(new Set());
                      }}>Toggle All</button>
                    )}
                    <label className="text-[9px] text-pink-300 hover:text-white cursor-pointer transition-colors flex items-center gap-1 bg-pink-500/10 px-1.5 py-0.5 rounded border border-pink-500/20" title="Upload complexity_analysis.json">
                        <Upload className="w-3 h-3" />
                        {hasAnalysis ? 'Update JSON' : 'Upload JSON'}
                        <input type="file" accept=".json" className="hidden" onChange={(e) => handleFileUpload(e, 'analysis')} />
                    </label>
                  </div>
                </div>
                {activeLevelsArray.length > 0 ? (
                  <div className="flex flex-wrap gap-2">
                    {activeLevelsArray.map(lvl => {
                      const isChecked = !disabledLevels.has(lvl);
                      return (
                        <label key={lvl} className="flex items-center gap-1.5 text-[11px] text-neutral-300 cursor-pointer hover:text-white bg-neutral-900 px-2 py-1 rounded border border-neutral-800">
                          <input type="checkbox" checked={isChecked} onChange={(e) => {
                              const newSet = new Set(disabledLevels);
                              if (e.target.checked) newSet.delete(lvl); else newSet.add(lvl);
                              setDisabledLevels(newSet);
                          }} className="rounded border-neutral-700 bg-neutral-800 text-pink-500 focus:ring-pink-500 w-3 h-3" />
                          {lvl}
                        </label>
                      );
                    })}
                  </div>
                ) : (
                  <div className="text-[10px] text-neutral-500 italic mt-1">Upload analysis to filter tasks by complexity.</div>
                )}
              </div>

              {/* Dynamic N-Examples Filters */}
              {activeExampleCountsArray.length > 0 && (
                <div className="pt-2 border-t border-neutral-800/50">
                  <div className="flex items-center justify-between mb-2">
                    <label className="text-[11px] font-bold text-emerald-400 uppercase tracking-wider flex items-center gap-1">Train Examples</label>
                    <div className="flex gap-2 items-center">
                      <button className="text-[9px] text-neutral-400 hover:text-white transition-colors" onClick={() => {
                          if (disabledExampleCounts.size === 0) setDisabledExampleCounts(new Set(activeExampleCountsArray));
                          else setDisabledExampleCounts(new Set());
                      }}>Toggle All</button>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {activeExampleCountsArray.map(count => {
                      const isChecked = !disabledExampleCounts.has(count);
                      return (
                        <label key={count} className="flex items-center gap-1.5 text-[11px] text-neutral-300 cursor-pointer hover:text-white bg-neutral-900 px-2 py-1 rounded border border-neutral-800">
                          <input type="checkbox" checked={isChecked} onChange={(e) => {
                              const newSet = new Set(disabledExampleCounts);
                              if (e.target.checked) newSet.delete(count); else newSet.add(count);
                              setDisabledExampleCounts(newSet);
                          }} className="rounded border-neutral-700 bg-neutral-800 text-emerald-500 focus:ring-emerald-500 w-3 h-3" />
                          {count}
                        </label>
                      );
                    })}
                  </div>
                </div>
              )}

              <div className="pt-2 border-t border-neutral-800/50">
                <label className="flex items-center gap-1.5 text-[11px] font-bold text-purple-400 cursor-pointer hover:text-purple-300 transition-colors" title="Shortcut: Press Spacebar">
                  <input type="checkbox" checked={overlayMode} onChange={(e) => setOverlayMode(e.target.checked)} className="rounded border-neutral-700 bg-neutral-800 text-purple-500 focus:ring-purple-500" />
                  <Layers className="w-3.5 h-3.5" />
                  Overlay Eval Solution (Spacebar)
                </label>
              </div>

              {mismatchedSubsCount > 0 && (
                <div className="mt-3 p-2 bg-red-900/20 border border-red-900/50 rounded flex items-start gap-2">
                  <AlertTriangle className="w-3 h-3 text-red-500 shrink-0 mt-0.5" />
                  <p className="text-[10px] text-red-400 leading-tight">
                    <strong>Mismatch:</strong> {mismatchedSubsCount} submission IDs don't match any challenge ID.
                  </p>
                </div>
              )}
            </div>

            {/* Task List */}
            <div className="mt-4 space-y-1">
              {displayIds.map((taskId) => {
                const absoluteIndex = allTaskIds.indexOf(taskId) + 1;
                const hasChallenge = !!challenges[taskId];
                const hasSolution = !!solutions[taskId];
                const hasSub1 = !!submission1[taskId];
                const hasSub2 = !!submission2[taskId];
                const isMismatch = (hasSub1 || hasSub2) && !hasChallenge && !hasSolution;

                const testData = challenges[taskId]?.test;
                const isSub1Real = hasRealAttempt(submission1[taskId], testData);
                const isSub2Real = hasRealAttempt(submission2[taskId], testData);

                const s1Status = getTaskStatus(taskId, submission1[taskId]);
                const s2Status = getTaskStatus(taskId, submission2[taskId]);

                return (
                  <button
                    key={taskId}
                    onClick={() => setSelectedTaskId(taskId)}
                    className={`w-full text-left px-2 py-2 rounded-md flex items-center text-sm transition-colors ${
                      selectedTaskId === taskId
                        ? 'bg-blue-600 text-white'
                        : 'text-neutral-300 hover:bg-neutral-800'
                    }`}
                  >
                    <span className="text-[10px] font-mono text-neutral-500 w-6 opacity-70 shrink-0">{absoluteIndex}.</span>
                    <span className="font-mono truncate flex-1 text-xs">{taskId}</span>

                    <div className="flex gap-1.5 items-center shrink-0 ml-1">
                      {isMismatch && <span className="text-[9px] font-bold bg-red-900/50 text-red-400 px-1 rounded">MIS</span>}

                      {hasChallenge && <div className="w-1.5 h-1.5 rounded-full bg-blue-500" title="Has Challenge Data" />}
                      {hasSolution && <div className="w-1.5 h-1.5 rounded-full bg-purple-500" title="Has Solution Data" />}

                      {hasSub1 && (
                        <div className="relative flex items-center justify-center">
                           <div className={`w-2 h-2 rounded-full ${isSub1Real ? 'bg-yellow-500' : 'border border-yellow-500/30'}`} title="Sub 1" />
                           {s1Status === true && <CheckCircle2 className="w-3.5 h-3.5 text-green-400 absolute -top-1 -right-1.5 bg-neutral-900 rounded-full" />}
                           {s1Status === false && <XCircle className="w-3.5 h-3.5 text-red-500 absolute -top-1 -right-1.5 bg-neutral-900 rounded-full" />}
                        </div>
                      )}
                      {hasSub2 && (
                        <div className="relative flex items-center justify-center ml-1">
                           <div className={`w-2 h-2 rounded-full ${isSub2Real ? 'bg-teal-500' : 'border border-teal-500/30'}`} title="Sub 2" />
                           {s2Status === true && <CheckCircle2 className="w-3.5 h-3.5 text-green-400 absolute -top-1 -right-1.5 bg-neutral-900 rounded-full" />}
                           {s2Status === false && <XCircle className="w-3.5 h-3.5 text-red-500 absolute -top-1 -right-1.5 bg-neutral-900 rounded-full" />}
                        </div>
                      )}
                    </div>
                  </button>
                );
              })}
              {displayIds.length === 0 && (
                <div className="text-center text-neutral-500 mt-10 text-xs px-4 pb-10">
                  {allTaskIds.length > 0 ? 'No tasks match current filters.' : 'Please upload files to begin viewing tasks.'}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col h-full bg-neutral-900 overflow-hidden relative">
        {error && (
          <div className="absolute top-4 left-1/2 -translate-x-1/2 z-50 bg-red-900/90 text-red-200 px-4 py-2 rounded-lg flex items-center gap-2 shadow-xl">
            <AlertCircle className="w-5 h-5" />
            <span>{error}</span>
          </div>
        )}

        {isExporting && (
          <div className="absolute inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center">
            <div className="bg-neutral-800 p-6 rounded-xl shadow-2xl max-w-sm w-full text-center space-y-4">
              <div className="w-12 h-12 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto"></div>
              <h3 className="text-lg font-bold text-white">Exporting Workspace...</h3>
              {exportProgress > 0 && (
                <div className="w-full bg-neutral-700 rounded-full h-2.5">
                  <div className="bg-blue-500 h-2.5 rounded-full transition-all" style={{ width: `${exportProgress}%` }}></div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Dynamic Task View Wrapper */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* ALWAYS RENDER TOOLBAR for persistent Panel controls */}
          <div className="h-12 border-b border-neutral-800 flex items-center justify-between px-4 shrink-0 bg-neutral-900/50 backdrop-blur">
            <div className="flex items-center gap-3">
              <button
                onClick={() => setShowSidebar(!showSidebar)}
                className={`p-1.5 rounded-md transition-colors ${!showSidebar ? 'bg-blue-600 text-white hover:bg-blue-500' : 'bg-neutral-800 text-neutral-300 hover:bg-neutral-700'}`}
                title="Toggle Sidebar"
              >
                <Menu className="w-4 h-4" />
              </button>
              {selectedTaskId ? (
                <>
                  <span className="text-sm font-mono text-neutral-500">Task {allTaskIds.indexOf(selectedTaskId) + 1}:</span>
                  <h2 className="text-xl font-bold font-mono tracking-tight">{selectedTaskId}</h2>
                  {hasAnalysis && (
                    <span className="bg-pink-500/20 text-pink-400 text-[10px] font-bold px-2 py-0.5 rounded border border-pink-500/30">
                      Level: {complexityData[selectedTaskId]?.level ?? 'Uncategorized'}
                    </span>
                  )}
                  {challenges[selectedTaskId]?.train?.length && (
                    <span className="bg-emerald-500/20 text-emerald-400 text-[10px] font-bold px-2 py-0.5 rounded border border-emerald-500/30" title="Number of Training Examples">
                      N={challenges[selectedTaskId].train.length}
                    </span>
                  )}
                </>
              ) : (
                <span className="text-sm font-mono text-neutral-500">Welcome</span>
              )}
            </div>
            <div className="flex items-center gap-3">
              {/* EXPORT IDS BUTTON */}
              {(hasSub1File || hasSub2File) && (
                <button
                  onClick={() => setShowExportModal(true)}
                  className="flex items-center gap-2 px-3 py-1.5 bg-neutral-800 hover:bg-neutral-700 text-neutral-200 rounded-md text-xs font-medium transition-colors"
                  title="Export List of Evaluated Task IDs"
                >
                  <FileText className="w-4 h-4" />
                  Export IDs
                </button>
              )}

              {selectedTaskId && (
                <button
                  onClick={exportWorkspaceToZip}
                  className="flex items-center gap-2 px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white rounded-md text-xs font-medium transition-colors shadow-lg shadow-blue-900/20"
                  title="Export data, stats, IDs, and visualizations as ZIP"
                >
                  <Archive className="w-4 h-4" />
                  Export Workspace
                </button>
              )}
              <button
                onClick={() => setShowFooter(!showFooter)}
                className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${showFooter ? 'bg-neutral-800 hover:bg-neutral-700 text-neutral-200' : 'bg-blue-600/20 text-blue-400 hover:bg-blue-600/30 border border-blue-500/30'}`}
                title="Toggle Bottom Stats Panel"
              >
                <BarChart2 className="w-4 h-4" />
                Stats
              </button>
            </div>
          </div>

          {/* Canvas / Visualizer Area */}
          <div className="flex-1 overflow-auto p-4 space-y-6">
            {selectedTaskId && (challenges[selectedTaskId] || solutions[selectedTaskId] || submission1[selectedTaskId] || submission2[selectedTaskId]) ? (
              <TaskView
                taskId={selectedTaskId}
                challenges={challenges}
                solutions={solutions}
                sub1={submission1[selectedTaskId]}
                sub2={submission2[selectedTaskId]}
                sub1Name={sub1Name}
                sub2Name={sub2Name}
                overlayMode={overlayMode}
              />
            ) : (
              <div className="flex-1 flex h-full items-center justify-center text-neutral-500 flex-col gap-4">
                <ImageIcon className="w-16 h-16 opacity-20" />
                <p>Select a task from the sidebar to visualize.</p>
              </div>
            )}
          </div>
        </div>

        {/* Dashboard Footer (Sticky to Bottom) */}
        {showFooter && displayIds.length > 0 && (
          <div className={`bg-neutral-950 border-t border-neutral-800 shrink-0 overflow-y-auto custom-scrollbar shadow-[0_-10px_20px_rgba(0,0,0,0.3)] z-50 transition-all duration-300 ease-in-out ${footerExpanded ? 'absolute bottom-0 right-0 left-0 h-[calc(100vh-48px)]' : 'relative max-h-64'}`}>
            <div className="sticky top-0 bg-neutral-950/95 backdrop-blur z-20 px-4 pt-3 pb-2 flex justify-between items-center mb-2 border-b border-neutral-800/50">
              <h3 className="text-[11px] font-bold text-neutral-400 uppercase tracking-wider flex items-center gap-1.5">
                 <BarChart2 className="w-3.5 h-3.5 text-blue-400" /> Score & Complexity Summary
              </h3>
              <div className="flex items-center gap-4">
                 <button
                   onClick={() => setFooterExpanded(!footerExpanded)}
                   className="text-neutral-500 hover:text-white transition-colors p-1 bg-neutral-900 rounded border border-neutral-800"
                   title={footerExpanded ? "Collapse panel" : "Expand to Full Height"}
                 >
                   {footerExpanded ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
                 </button>
              </div>
            </div>

            <div className="px-4 pb-4">
              <div className="space-y-6">
                 {/* Table 1: By Complexity Level */}
                 <div className="w-full overflow-x-auto">
                    <table className="w-full text-left text-xs whitespace-nowrap">
                       <thead>
                          <tr className="text-neutral-500 border-b border-neutral-800">
                             <th className="pb-1.5 font-medium px-2">Level</th>
                             <th className="pb-1.5 font-medium px-2">Tasks</th>
                             {hasSub1File && <th className="pb-1.5 font-medium px-2">Sub 1 </th>}
                             {hasSub2File && <th className="pb-1.5 font-medium px-2">Sub 2 </th>}
                          </tr>
                       </thead>
                       <tbody className="divide-y divide-neutral-800/50">
                          <tr className="bg-neutral-800/30 font-bold text-neutral-200">
                             <td className="py-2 px-2 text-blue-400">Overall</td>
                             <td className="py-2 px-2 text-neutral-300">{stats.overall.total}</td>
                             {hasSub1File && <td className="py-2 px-2">{renderScoreAndError(stats.overall, 1, filterRealAttempts)}</td>}
                             {hasSub2File && <td className="py-2 px-2">{renderScoreAndError(stats.overall, 2, filterRealAttempts)}</td>}
                          </tr>
                          {hasAnalysis && Object.entries(stats.byLevel).sort(([a], [b]) => a.localeCompare(b, undefined, {numeric: true})).map(([level, data]) => (
                             <tr key={level} className="hover:bg-neutral-800/20 transition-colors">
                                <td className="py-1.5 px-2 text-neutral-400 flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-pink-500/50 inline-block"></span> Level {level}</td>
                                <td className="py-1.5 px-2 text-neutral-500 font-medium">{data.total}</td>
                                {hasSub1File && <td className="py-1.5 px-2">{renderScoreAndError(data, 1, filterRealAttempts)}</td>}
                                {hasSub2File && <td className="py-1.5 px-2">{renderScoreAndError(data, 2, filterRealAttempts)}</td>}
                             </tr>
                          ))}
                       </tbody>
                    </table>
                 </div>

                 <div className="flex flex-col md:flex-row gap-6">
                   {/* Table 2: By Number of Train Examples */}
                   <div className="flex-1 overflow-x-auto">
                      <h3 className="text-[11px] font-bold text-neutral-400 uppercase tracking-wider mb-3 flex items-center gap-1.5">
                         <BarChart2 className="w-3.5 h-3.5 text-emerald-400" /> Score by Training Examples (N)
                      </h3>
                      <table className="w-full text-left text-xs whitespace-nowrap">
                         <thead>
                            <tr className="text-neutral-500 border-b border-neutral-800">
                               <th className="pb-1.5 font-medium px-2">Examples</th>
                               <th className="pb-1.5 font-medium px-2">Tasks</th>
                               {hasSub1File && <th className="pb-1.5 font-medium px-2">Sub 1 </th>}
                               {hasSub2File && <th className="pb-1.5 font-medium px-2">Sub 2 </th>}
                            </tr>
                         </thead>
                         <tbody className="divide-y divide-neutral-800/50">
                            {Object.entries(stats.byNExamples).sort(([a], [b]) => Number(a) - Number(b)).map(([n, data]) => (
                               <tr key={n} className="hover:bg-neutral-800/20 transition-colors">
                                  <td className="py-1.5 px-2 text-neutral-400 flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-emerald-500/50 inline-block"></span> N = {n}</td>
                                  <td className="py-1.5 px-2 text-neutral-500 font-medium">{data.total}</td>
                                  {hasSub1File && <td className="py-1.5 px-2">{renderScoreAndError(data, 1, filterRealAttempts)}</td>}
                                  {hasSub2File && <td className="py-1.5 px-2">{renderScoreAndError(data, 2, filterRealAttempts)}</td>}
                               </tr>
                            ))}
                         </tbody>
                      </table>
                   </div>

                   {/* Table 3: By Number of Subproblems */}
                   <div className="flex-1 overflow-x-auto">
                      <h3 className="text-[11px] font-bold text-neutral-400 uppercase tracking-wider mb-3 flex items-center gap-1.5">
                         <ListTree className="w-3.5 h-3.5 text-purple-400" /> Score by Subproblems (Test Pairs)
                      </h3>
                      <table className="w-full text-left text-xs whitespace-nowrap">
                         <thead>
                            <tr className="text-neutral-500 border-b border-neutral-800">
                               <th className="pb-1.5 font-medium px-2">Subproblems</th>
                               <th className="pb-1.5 font-medium px-2">Tasks</th>
                               {hasSub1File && <th className="pb-1.5 font-medium px-2">Sub 1 </th>}
                               {hasSub2File && <th className="pb-1.5 font-medium px-2">Sub 2 </th>}
                            </tr>
                         </thead>
                         <tbody className="divide-y divide-neutral-800/50">
                            {Object.entries(stats.bySubproblems)
                               .sort(([a], [b]) => a === 'Unknown' ? 1 : b === 'Unknown' ? -1 : Number(a) - Number(b))
                               .map(([n, data]) => (
                               <tr key={n} className="hover:bg-neutral-800/20 transition-colors">
                                  <td className="py-1.5 px-2 text-neutral-400 flex items-center gap-1">
                                     <span className="w-1.5 h-1.5 rounded-full bg-purple-500/50 inline-block"></span> {n === 'Unknown' ? n : `${n} Pair${n === '1' ? '' : 's'}`}
                                  </td>
                                  <td className="py-1.5 px-2 text-neutral-500 font-medium">{data.total}</td>
                                  {hasSub1File && <td className="py-1.5 px-2">{renderScoreAndError(data, 1, filterRealAttempts)}</td>}
                                  {hasSub2File && <td className="py-1.5 px-2">{renderScoreAndError(data, 2, filterRealAttempts)}</td>}
                               </tr>
                            ))}
                         </tbody>
                      </table>
                   </div>
                 </div>

                 {/* Pivot Table: Overlap Analysis */}
                 <div className="w-full overflow-x-auto mt-6 pt-6 border-t border-neutral-800/50">
                    <div className="flex flex-col md:flex-row md:items-center justify-between mb-4 gap-4">
                       <h3 className="text-[11px] font-bold text-neutral-400 uppercase tracking-wider flex items-center gap-1.5">
                          <Layers className="w-3.5 h-3.5 text-indigo-400" /> Overlap Matrix (Task Count)
                       </h3>
                       <div className="flex items-center gap-3 text-xs bg-neutral-900 px-3 py-1.5 rounded-md border border-neutral-800">
                          <div className="flex items-center gap-1.5">
                             <label className="text-neutral-500 font-bold">Row:</label>
                             <select value={pivotRow} onChange={e => setPivotRow(e.target.value)} className="bg-transparent text-neutral-300 outline-none cursor-pointer">
                                {Object.entries(PIVOT_OPTIONS).map(([k, v]) => <option key={k} value={k} className="bg-neutral-900">{v}</option>)}
                             </select>
                          </div>
                          <span className="text-neutral-700">×</span>
                          <div className="flex items-center gap-1.5">
                             <label className="text-neutral-500 font-bold">Col:</label>
                             <select value={pivotCol} onChange={e => setPivotCol(e.target.value)} className="bg-transparent text-neutral-300 outline-none cursor-pointer">
                                {Object.entries(PIVOT_OPTIONS).map(([k, v]) => <option key={k} value={k} className="bg-neutral-900">{v}</option>)}
                             </select>
                          </div>
                       </div>
                    </div>

                    <table className="w-full text-left text-xs whitespace-nowrap">
                       <thead>
                          <tr>
                             <th className="pb-2 font-medium px-2 text-neutral-500 border-b border-neutral-800 bg-neutral-900/30">
                                {PIVOT_OPTIONS[pivotRow]} \ {PIVOT_OPTIONS[pivotCol]}
                             </th>
                             {sortedColKeys.map(c => <th key={c} className="pb-2 font-medium px-2 text-center text-neutral-300 border-b border-neutral-800 bg-neutral-900/30">{c}</th>)}
                             <th className="pb-2 font-bold px-2 text-center text-blue-400 border-b border-neutral-800 bg-neutral-900/30">Total</th>
                          </tr>
                       </thead>
                       <tbody className="divide-y divide-neutral-800/50">
                          {sortedRowKeys.map(r => {
                             let rowTotal = 0;
                             return (
                               <tr key={r} className="hover:bg-neutral-800/20 transition-colors">
                                  <td className="py-2 px-2 font-medium text-neutral-400 bg-neutral-900/20">{r}</td>
                                  {sortedColKeys.map(c => {
                                     const val = pivotData[r]?.[c] || 0;
                                     rowTotal += val;
                                     return <td key={c} className={`py-2 px-2 text-center ${val > 0 ? 'text-white font-bold' : 'text-neutral-600'}`}>{val > 0 ? val : '-'}</td>;
                                  })}
                                  <td className="py-2 px-2 text-center text-blue-400 font-bold bg-neutral-900/20">{rowTotal}</td>
                               </tr>
                             );
                          })}
                       </tbody>
                    </table>
                 </div>

                 {/* Metadata Section */}
                 {(s1MetaInfo.length > 0 || s2MetaInfo.length > 0) && (
                   <div className="mt-4 pt-4 border-t border-neutral-800 text-xs flex flex-col gap-2">
                      <h4 className="text-[10px] uppercase font-bold text-neutral-500 flex items-center gap-1">
                        <Info className="w-3 h-3" /> Submission Metadata
                      </h4>
                      {s1MetaInfo.length > 0 && (
                        <div className="text-neutral-400 break-words whitespace-normal">
                          <span className="text-yellow-500 font-bold mr-2">Sub 1:</span>
                          {s1MetaInfo.map(m => `${m.key}=${JSON.stringify(m.value)}`).join('  |  ')}
                        </div>
                      )}
                      {s2MetaInfo.length > 0 && (
                        <div className="text-neutral-400 break-words whitespace-normal">
                          <span className="text-teal-500 font-bold mr-2">Sub 2:</span>
                          {s2MetaInfo.map(m => `${m.key}=${JSON.stringify(m.value)}`).join('  |  ')}
                        </div>
                      )}
                   </div>
                 )}
              </div>
            </div>

            <style>{`
               .custom-scrollbar::-webkit-scrollbar { width: 6px; height: 6px; }
               .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
               .custom-scrollbar::-webkit-scrollbar-thumb { background-color: #333; border-radius: 10px; }
            `}</style>
          </div>
        )}
      </div>
    </div>
  );
}

// Reusable component to render the grid similarity metrics, size changes, and color differences
function SimilarityMetrics({ stats, baselineStats, type }) {
  if (!stats) return null;

  let improvement = null;
  if (baselineStats && type === 'attemptVsSol') {
     const simChange = stats.similarityPct - baselineStats.similarityPct;
     if (simChange > 0.1) {
        improvement = <span className="text-green-400 flex items-center text-[10px] font-medium"><TrendingUp className="w-3 h-3 mr-0.5"/> {simChange.toFixed(1)}% better</span>;
     } else if (simChange < -0.1) {
        improvement = <span className="text-red-400 flex items-center text-[10px] font-medium"><TrendingDown className="w-3 h-3 mr-0.5"/> {Math.abs(simChange).toFixed(1)}% worse</span>;
     } else {
        improvement = <span className="text-neutral-500 flex items-center text-[10px] font-medium"><Minus className="w-3 h-3 mr-0.5"/> No change</span>;
     }
  } else if (type === 'chalVsSol' || type === 'trainInVsOut') {
     improvement = <span className="text-blue-400 flex items-center text-[10px] font-medium tracking-wide uppercase">Baseline Sim</span>;
  }

  let labelText = "Attempt vs Sol:";
  if (type === 'chalVsSol') labelText = "Chal vs Sol:";
  else if (type === 'attemptVsChal') labelText = "Attempt vs Chal:";
  else if (type === 'trainInVsOut') labelText = "Input vs Output:";

  const isPerfect = stats.similarityPct === 100;

  const sizeDiff = stats.targetArea - stats.sourceArea;
  const sizeDiffText = sizeDiff > 0 ? `+${sizeDiff}` : `${sizeDiff}`;
  const sizeDiffColor = sizeDiff > 0 ? 'text-green-400' : 'text-red-400';

  return (
    <div className="flex flex-col gap-1.5 bg-neutral-950/60 p-2 rounded-md border border-neutral-800/80 w-fit min-w-[160px] shadow-sm">
       <div className="flex justify-between items-center gap-4">
          <span className="text-[10px] text-neutral-400 flex items-baseline gap-1">
            {labelText} <b className={isPerfect ? "text-green-400" : "text-white"}>{stats.similarityPct.toFixed(1)}%</b>
          </span>
          {improvement}
       </div>

       <div className="flex flex-col gap-0.5">
           <div className="text-[10px] text-neutral-300">
               <span className="font-bold text-white">{stats.matches}</span> / {stats.targetArea} squares matched
           </div>
           <div className="text-[10px] text-neutral-400 flex items-center gap-1">
               Grid size: {stats.sourceArea} → {stats.targetArea} sq
               {!stats.sizeMatch && (
                   <span className={sizeDiffColor}>({sizeDiffText})</span>
               )}
           </div>
       </div>

       {stats.colorDiffs.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-0.5">
             {stats.colorDiffs.map(cd => (
                <div key={cd.color} className="flex items-center text-[9px] bg-neutral-900 px-1 py-0.5 rounded border border-neutral-800" title={cd.diff < 0 ? "Extra pixels generated (Too much)" : "Missing expected pixels (Needs more)"}>
                   <span className="w-2 h-2 inline-block mr-1 rounded-none border border-neutral-700" style={{backgroundColor: ARC_COLORS[cd.color]}}></span>
                   <span className={cd.diff < 0 ? "text-red-400 font-medium" : "text-blue-400 font-medium"}>{cd.diff > 0 ? `+${cd.diff}` : cd.diff}</span>
                </div>
             ))}
          </div>
       )}
    </div>
  );
}

function TaskView({ taskId, challenges, solutions, sub1, sub2, sub1Name, sub2Name, overlayMode }) {
  const task = challenges[taskId];
  const pairCount = getPairCount(challenges, solutions, sub1, sub2, taskId);

  return (
    <div className="space-y-6 pb-12">
      {/* Train Examples */}
      {task && task.train && task.train.length > 0 && (
        <section>
          <div className="flex items-center gap-2 mb-3">
            <h3 className="text-sm font-bold text-blue-400 uppercase tracking-wider">Train Examples</h3>
            <div className="flex-1 h-px bg-neutral-800 ml-4"></div>
          </div>
          <div className="flex flex-wrap gap-3">
            {task.train.map((pair, idx) => {
              const trainStats = pair.input && pair.output ? getSimilarityStats(pair.input, pair.output) : null;
              return (
                <div key={idx} className="flex flex-col gap-2 bg-neutral-800/30 p-3 rounded-lg border border-neutral-800 shrink-0">
                  <span className="text-[11px] font-semibold text-neutral-500 uppercase tracking-wider">Pair {idx + 1}</span>
                  <div className="flex items-start gap-3">
                    <div className="flex flex-col">
                      <GridBlock title="Train Problem" grid={pair.input} />
                      {trainStats && (
                        <div className="mt-1.5">
                           <SimilarityMetrics stats={trainStats} type="trainInVsOut" />
                        </div>
                      )}
                    </div>
                    <div className="mt-8">
                      <ChevronRight className="w-4 h-4 text-neutral-600" />
                    </div>
                    <GridBlock title="Train Solution" grid={pair.output} />
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* Test & Submissions */}
      {pairCount > 0 && (
        <section>
          <div className="flex items-center gap-2 mb-3">
            <h3 className="text-sm font-bold text-yellow-400 uppercase tracking-wider">Test & Submissions</h3>
            <div className="flex-1 h-px bg-neutral-800 ml-4"></div>
          </div>
          <div className="flex flex-col gap-4">

            {Array.from({ length: pairCount }).map((_, idx) => {
              const inputGrid = task?.test?.[idx]?.input;
              const expected = getExpectedOutput(challenges, solutions, taskId, idx);
              const s1 = sub1 ? sub1[idx] : null;
              const s2 = sub2 ? sub2[idx] : null;

              const s1MetaStr = formatItemMeta(s1);
              const s2MetaStr = formatItemMeta(s2);

              const inputStats = inputGrid && expected ? getSimilarityStats(inputGrid, expected) : null;
              const s1a1Stats = s1?.attempt_1 && expected ? getSimilarityStats(s1.attempt_1, expected) : null;
              const s1a1InputStats = s1?.attempt_1 && inputGrid ? getSimilarityStats(s1.attempt_1, inputGrid) : null;
              const s1a2Stats = s1?.attempt_2 && expected ? getSimilarityStats(s1.attempt_2, expected) : null;
              const s1a2InputStats = s1?.attempt_2 && inputGrid ? getSimilarityStats(s1.attempt_2, inputGrid) : null;
              const s2a1Stats = s2?.attempt_1 && expected ? getSimilarityStats(s2.attempt_1, expected) : null;
              const s2a1InputStats = s2?.attempt_1 && inputGrid ? getSimilarityStats(s2.attempt_1, inputGrid) : null;
              const s2a2Stats = s2?.attempt_2 && expected ? getSimilarityStats(s2.attempt_2, expected) : null;
              const s2a2InputStats = s2?.attempt_2 && inputGrid ? getSimilarityStats(s2.attempt_2, inputGrid) : null;

              return (
                <div key={idx} className="flex flex-col gap-3 bg-neutral-800/30 p-4 rounded-lg border border-yellow-900/30 shrink-0">
                  <span className="text-[11px] font-semibold text-neutral-500 uppercase tracking-wider">Example {idx + 1}</span>

                  <div className="flex flex-wrap items-start gap-4">

                    {(inputGrid || expected) && (
                      <div className="flex flex-col gap-2 bg-neutral-900/40 p-3 rounded-lg border border-neutral-800/50">
                        <div className="h-[18px] flex items-end">
                           <span className="text-[10px] font-bold text-neutral-500 uppercase tracking-wide">Reference</span>
                        </div>
                        <div className="flex items-start gap-3">
                          {inputGrid && (
                            <div className="flex flex-col">
                              <GridBlock title="Eval Problem" grid={inputGrid} />
                              <div className="mt-1.5">
                                 <SimilarityMetrics stats={inputStats} type="chalVsSol" />
                              </div>
                            </div>
                          )}
                          {expected && (
                            <>
                              {inputGrid && <div className="mt-8"><ChevronRight className="w-4 h-4 text-neutral-600" /></div>}
                              <GridBlock title="Eval Solution" grid={expected} highlight />
                            </>
                          )}
                        </div>
                      </div>
                    )}

                    {s1 && (
                      <div className="flex flex-col gap-2 p-3 border-l-2 border-yellow-500/50 bg-neutral-900/20 rounded-r-lg">
                        <div className="h-[18px] flex items-end justify-between gap-4">
                           <span className="text-[10px] font-bold text-yellow-500 uppercase tracking-wide truncate max-w-[200px]" title={sub1Name}>
                             {sub1Name || "Submission 1"}
                           </span>
                           {s1MetaStr && <span className="text-[9px] font-mono text-neutral-400 bg-neutral-950 px-1.5 rounded border border-neutral-800 whitespace-nowrap">{s1MetaStr}</span>}
                        </div>
                        <div className="flex items-start gap-3">
                          {s1.attempt_1 && (
                            <div className="flex flex-col">
                              <GridBlock
                                title="Attempt 1"
                                badge={isCopiedInput(s1.attempt_1, task?.test) ? "Copied Input" : isDummyGrid(s1.attempt_1) ? "Dummy [0]" : null}
                                grid={s1.attempt_1}
                                evalExpected={expected}
                                overlayExpected={overlayMode && !isDummyGrid(s1.attempt_1) ? expected : null}
                              />
                              <div className="flex flex-col gap-1.5 mt-1.5">
                                 <SimilarityMetrics stats={s1a1Stats} baselineStats={inputStats} type="attemptVsSol" />
                                 <SimilarityMetrics stats={s1a1InputStats} type="attemptVsChal" />
                              </div>
                            </div>
                          )}
                          {s1.attempt_2 && (
                            <div className="flex flex-col">
                              <GridBlock
                                title="Attempt 2"
                                badge={isCopiedInput(s1.attempt_2, task?.test) ? "Copied Input" : isDummyGrid(s1.attempt_2) ? "Dummy [0]" : null}
                                grid={s1.attempt_2}
                                evalExpected={expected}
                                overlayExpected={overlayMode && !isDummyGrid(s1.attempt_2) ? expected : null}
                              />
                              <div className="flex flex-col gap-1.5 mt-1.5">
                                 <SimilarityMetrics stats={s1a2Stats} baselineStats={inputStats} type="attemptVsSol" />
                                 <SimilarityMetrics stats={s1a2InputStats} type="attemptVsChal" />
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    )}

                    {s2 && (
                      <div className="flex flex-col gap-2 p-3 border-l-2 border-teal-500/50 bg-neutral-900/20 rounded-r-lg">
                        <div className="h-[18px] flex items-end justify-between gap-4">
                           <span className="text-[10px] font-bold text-teal-500 uppercase tracking-wide truncate max-w-[200px]" title={sub2Name}>
                             {sub2Name || "Submission 2"}
                           </span>
                           {s2MetaStr && <span className="text-[9px] font-mono text-neutral-400 bg-neutral-950 px-1.5 rounded border border-neutral-800 whitespace-nowrap">{s2MetaStr}</span>}
                        </div>
                        <div className="flex items-start gap-3">
                          {s2.attempt_1 && (
                            <div className="flex flex-col">
                              <GridBlock
                                title="Attempt 1"
                                badge={isCopiedInput(s2.attempt_1, task?.test) ? "Copied Input" : isDummyGrid(s2.attempt_1) ? "Dummy [0]" : null}
                                grid={s2.attempt_1}
                                evalExpected={expected}
                                overlayExpected={overlayMode && !isDummyGrid(s2.attempt_1) ? expected : null}
                              />
                              <div className="flex flex-col gap-1.5 mt-1.5">
                                 <SimilarityMetrics stats={s2a1Stats} baselineStats={inputStats} type="attemptVsSol" />
                                 <SimilarityMetrics stats={s2a1InputStats} type="attemptVsChal" />
                              </div>
                            </div>
                          )}
                          {s2.attempt_2 && (
                            <div className="flex flex-col">
                              <GridBlock
                                title="Attempt 2"
                                badge={isCopiedInput(s2.attempt_2, task?.test) ? "Copied Input" : isDummyGrid(s2.attempt_2) ? "Dummy [0]" : null}
                                grid={s2.attempt_2}
                                evalExpected={expected}
                                overlayExpected={overlayMode && !isDummyGrid(s2.attempt_2) ? expected : null}
                              />
                              <div className="flex flex-col gap-1.5 mt-1.5">
                                 <SimilarityMetrics stats={s2a2Stats} baselineStats={inputStats} type="attemptVsSol" />
                                 <SimilarityMetrics stats={s2a2InputStats} type="attemptVsChal" />
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}

function GridBlock({ title, badge, grid, highlight, evalExpected, overlayExpected }) {
  if (!grid || !Array.isArray(grid) || !Array.isArray(grid[0])) {
    return (
      <div className="flex flex-col gap-1">
        <div className="h-[28px] flex items-end pb-1">
          <span className="text-[10px] uppercase font-bold text-neutral-400">{title}</span>
        </div>
        <div className="text-red-500 text-[10px] border border-red-900/50 p-2 rounded bg-red-900/10">Invalid</div>
      </div>
    );
  }

  const rows = grid.length;
  const cols = grid[0].length;
  const uniqueColorsCount = new Set(grid.flat()).size;

  let gradeBorder = '';
  let gradeIcon = null;
  if (evalExpected) {
    const isCorrect = gridsMatch(grid, evalExpected);
    if (isCorrect) {
      gradeBorder = 'ring-2 ring-green-500 ring-offset-2 ring-offset-neutral-900';
      gradeIcon = <CheckCircle2 className="w-3 h-3 text-green-500 ml-1 inline shrink-0" />;
    } else {
      gradeBorder = 'ring-2 ring-red-500/50 ring-offset-1 ring-offset-neutral-900';
      gradeIcon = <XCircle className="w-3 h-3 text-red-500/70 ml-1 inline shrink-0" />;
    }
  }

  const highlightClasses = highlight ? 'ring-2 ring-green-500 ring-offset-2 ring-offset-neutral-900' : '';

  const maxDim = Math.max(rows, cols);
  let cellSize = 'w-4 h-4 sm:w-5 sm:h-5';
  if (maxDim >= 20) cellSize = 'w-1.5 h-1.5';
  else if (maxDim >= 15) cellSize = 'w-2 h-2';
  else if (maxDim >= 10) cellSize = 'w-3 h-3';

  return (
    <div className="flex flex-col gap-1">
      <div className="h-[28px] flex items-end pb-1">
         <span className="text-[10px] uppercase font-bold text-neutral-400 flex items-center gap-1 flex-wrap leading-tight">
           {title}
           <span className="text-[9px] text-neutral-600 bg-neutral-800 px-1 rounded whitespace-nowrap">{cols}x{rows} • {uniqueColorsCount}c</span>
           {badge && <span className="text-[9px] bg-red-900/30 text-red-400 border border-red-900/50 px-1.5 rounded whitespace-nowrap uppercase tracking-wider">{badge}</span>}
           {gradeIcon}
         </span>
      </div>

      <div className="relative inline-flex">
        <div className={`bg-neutral-700 p-[1px] flex flex-col gap-[1px] shadow-sm ${highlightClasses} ${gradeBorder}`}>
          {grid.map((row, rIdx) => (
            <div key={rIdx} className="flex gap-[1px]">
              {row.map((val, cIdx) => (
                <div
                  key={cIdx}
                  className={cellSize}
                  style={{ backgroundColor: ARC_COLORS[val] || '#000000' }}
                  title={`Color: ${val}`}
                />
              ))}
            </div>
          ))}
        </div>

        {overlayExpected && Array.isArray(overlayExpected) && overlayExpected.length > 0 && (
          <div className="absolute top-0 left-0 w-full h-full p-[1px] flex flex-col gap-[1px] opacity-60 pointer-events-none z-10 transition-opacity overflow-hidden">
            {overlayExpected.map((row, rIdx) => (
              <div key={rIdx} className="flex gap-[1px]">
                {row.map((val, cIdx) => (
                  <div
                    key={cIdx}
                    className={`${cellSize} shadow-[inset_0_0_0_1px_rgba(255,255,255,0.15)]`}
                    style={{ backgroundColor: ARC_COLORS[val] || '#000000' }}
                  />
                ))}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
