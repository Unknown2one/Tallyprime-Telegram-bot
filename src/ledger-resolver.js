const mcpManager = require('./mcp-manager');

// Devanagari to Roman script transliteration map
const DevanagariMapping = {
  'अ': 'a', 'आ': 'a', 'इ': 'i', 'ई': 'ee', 'उ': 'u', 'ऊ': 'oo', 'ऋ': 'ri',
  'ए': 'e', 'ऐ': 'ai', 'ओ': 'o', 'औ': 'au', 'अं': 'an', 'अः': 'ah',
  'ा': 'a', 'ि': 'i', 'ी': 'ee', 'ु': 'u', 'ू': 'oo', 'े': 'e', 'ै': 'ai',
  'ो': 'o', 'ौ': 'au', 'ं': 'n', 'ः': 'h', 'ॅ': 'a', 'ॉ': 'o',
  'क': 'k', 'ख': 'kh', 'ग': 'g', 'घ': 'gh', 'ङ': 'n',
  'च': 'ch', 'छ': 'chh', 'ज': 'j', 'झ': 'jh', 'ञ': 'n',
  'ट': 't', 'ठ': 'th', 'ड': 'd', 'ढ': 'dh', 'ण': 'n',
  'त': 't', 'थ': 'th', 'द': 'd', 'ध': 'dh', 'न': 'n',
  'प': 'p', 'फ': 'ph', 'ब': 'b', 'भ': 'bh', 'म': 'm',
  'य': 'y', 'र': 'r', 'ल': 'l', 'व': 'v', 'श': 'sh', 'ष': 'sh', 'स': 's', 'ह': 'h',
  'क्ष': 'ksh', 'त्र': 'tr', 'ज्ञ': 'gy',
  'श्र': 'shr', '्': '', '़': ''
};

function transliterateDevanagari(text) {
  if (!text) return '';
  const words = text.split(/\s+/);
  const mappedWords = words.map(word => {
    let wordResult = '';
    for (let i = 0; i < word.length; i++) {
      const char = word[i];
      const nextChar = word[i + 1];
      
      if (char === 'श' && nextChar === '्' && word[i + 2] === 'र') {
        wordResult += 'shr';
        i += 2;
        continue;
      }
      
      const mapped = DevanagariMapping[char];
      if (mapped !== undefined) {
        wordResult += mapped;
        
        const isConsonant = 'कखगघङचछजझञटठडढणतथदधनपफबभमयरलवशषसह'.includes(char);
        if (isConsonant && nextChar) {
          const nextIsMatraOrVirama = 'ािीुूेैोौं्ॅॉ'.includes(nextChar);
          if (!nextIsMatraOrVirama) {
            wordResult += 'a';
          }
        }
      } else {
        wordResult += char;
      }
    }
    return wordResult;
  });
  return mappedWords.join(' ').toLowerCase();
}

function normalizePhonetic(str) {
  return str.toLowerCase()
    .replace(/w/g, 'v')
    .replace(/ee/g, 'i')
    .replace(/oo/g, 'u')
    .replace(/aa/g, 'a')
    .replace(/c(?!h)/g, 'k')
    .replace(/y/g, 'i')
    .replace(/z/g, 'j') // Map z -> j for consistent Indian spelling match
    .replace(/[^a-z0-9\s]/g, '');
}

// Dice coefficient calculation for fuzzy matching
function getSimilarity(s1, s2) {
  let str1 = s1.toLowerCase().replace(/[^a-z0-9]/g, '');
  let str2 = s2.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (str1 === str2) return 1.0;
  if (str1.length < 2 || str2.length < 2) return 0.0;

  let firstBigrams = new Map();
  for (let i = 0; i < str1.length - 1; i++) {
    const bigram = str1.substring(i, i + 2);
    const count = firstBigrams.has(bigram) ? firstBigrams.get(bigram) + 1 : 1;
    firstBigrams.set(bigram, count);
  }

  let intersectionSize = 0;
  for (let i = 0; i < str2.length - 1; i++) {
    const bigram = str2.substring(i, i + 2);
    const count = firstBigrams.has(bigram) ? firstBigrams.get(bigram) : 0;
    if (count > 0) {
      firstBigrams.set(bigram, count - 1);
      intersectionSize++;
    }
  }

  return (2.0 * intersectionSize) / (str1.length + str2.length - 2);
}

async function resolveLedger(query) {
  const tallyClient = mcpManager.getTallyClient();
  if (!tallyClient) {
    throw new Error('Tally client not connected');
  }

  const cleanQuery = query.toLowerCase().trim();
  const words = cleanQuery.split(/\s+/).filter(w => w.length >= 2);

  let allLedgerNames = [];

  if (words.length > 0) {
    // Call list-master with containsFilter for each word in parallel
    const promises = words.map(word => 
      tallyClient.callTool({
        name: 'list-master',
        arguments: { collection: 'ledger', containsFilter: word }
      }).catch(err => {
        console.error(`Error calling list-master for "${word}":`, err.message);
        return { isError: true, content: [] };
      })
    );
    
    const results = await Promise.all(promises);
    const nameSet = new Set();
    for (const res of results) {
      if (res && !res.isError && res.content && res.content.length > 0) {
        try {
          const data = JSON.parse(res.content[0].text);
          if (data && data.list) {
            data.list.forEach(name => nameSet.add(name));
          }
        } catch (e) {}
      }
    }
    allLedgerNames = Array.from(nameSet);
  }

  // Fallback to fetching all ledger names if no results found via word filtering (e.g. very short query)
  if (allLedgerNames.length === 0) {
    const listRes = await tallyClient.callTool({
      name: 'list-master',
      arguments: { collection: 'ledger' }
    });
    const masters = JSON.parse(listRes.content[0].text);
    allLedgerNames = masters.list || [];
  }
  
  // 1. Exact match first
  let exact = allLedgerNames.find(name => name.toLowerCase() === cleanQuery);
  if (exact) {
    return { matched: exact, options: [] };
  }
  
  // 2. Simple substring check (only if query length >= 4, or if the ledger name starts with the query)
  let substringMatches = allLedgerNames.filter(name => {
    const nameLower = name.toLowerCase();
    return nameLower.includes(cleanQuery) && (cleanQuery.length >= 4 || nameLower.startsWith(cleanQuery));
  });
  if (substringMatches.length === 1) {
    return { matched: substringMatches[0], options: [] };
  }
  
  // 3. Phonetic and Dice similarity matching with score
  const queryTrans = transliterateDevanagari(cleanQuery);
  const queryNorm = normalizePhonetic(queryTrans);
  const queryNormWords = queryNorm.split(/\s+/).filter(w => w.length > 0);
  const queryWords = cleanQuery.split(/\s+/).filter(w => w.length > 0);
  
  const scored = allLedgerNames.map(name => {
    const lLower = name.toLowerCase();
    const lTrans = transliterateDevanagari(name);
    const lNorm = normalizePhonetic(lTrans);
    const lNormWords = lNorm.split(/\s+/).filter(w => w.length > 0);
    
    let score = 0;
    
    // Exact normalized phonetic match
    if (lNorm === queryNorm) {
      score += 90;
    }
    // Substring normalized phonetic match
    if (lNorm.includes(queryNorm) || queryNorm.includes(lNorm)) {
      score += 50;
    }
    
    // Word overlap matching
    queryNormWords.forEach(qw => {
      if (lNormWords.includes(qw)) {
        score += 15;
      } else if (lNorm.includes(qw)) {
        score += 8;
      }
    });

    // Exact word matching bonus
    queryWords.forEach(qw => {
      if (lLower.includes(qw)) {
        score += 10;
      }
    });

    // Dice similarity bonus (max 30 points)
    const diceSim = getSimilarity(cleanQuery, name);
    score += Math.round(diceSim * 30);
    
    return { name, score };
  }).filter(item => item.score > 0);
  
  scored.sort((a, b) => b.score - a.score);
  
  if (scored.length === 0) {
    return { matched: null, options: [] };
  }
  
  const topScore = scored[0].score;
  const secondScore = scored[1] ? scored[1].score : 0;
  
  // If top match is highly confident and is a distinct winner (margin >= 10 points above second match)
  if (topScore >= 80 && (topScore - secondScore) >= 10) {
    return { matched: scored[0].name, options: [] };
  }
  
  // Otherwise filter options within 20 points of topScore (down to 0)
  const options = scored.filter(item => item.score >= Math.max(0, topScore - 20));
  if (options.length === 1 && topScore >= 70) {
    return { matched: options[0].name, options: [] };
  }
  
  return { matched: null, options: options.map(item => item.name).slice(0, 5) };
}

module.exports = { resolveLedger };
