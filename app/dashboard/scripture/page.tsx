// @ts-nocheck
'use client';

import { useState, useEffect, useMemo } from 'react';

/* ============================================================
   Daily Scripture — 15-minute Bible reading & Scripture memory (ESV)
   Self-contained page. Progress saved in localStorage on this device.
   ============================================================ */

const VERSES = [
 {r:"John 3:16",t:"Salvation",x:"For God so loved the world, that he gave his only Son, that whoever believes in him should not perish but have eternal life."},
 {r:"Romans 3:23",t:"Salvation",x:"for all have sinned and fall short of the glory of God,"},
 {r:"Romans 6:23",t:"Salvation",x:"For the wages of sin is death, but the free gift of God is eternal life in Christ Jesus our Lord."},
 {r:"Ephesians 2:8-9",t:"Grace",x:"For by grace you have been saved through faith. And this is not your own doing; it is the gift of God, not a result of works, so that no one may boast."},
 {r:"Romans 5:8",t:"Love",x:"but God shows his love for us in that while we were still sinners, Christ died for us."},
 {r:"Romans 10:9",t:"Salvation",x:"because, if you confess with your mouth that Jesus is Lord and believe in your heart that God raised him from the dead, you will be saved."},
 {r:"2 Corinthians 5:17",t:"New life",x:"Therefore, if anyone is in Christ, he is a new creation. The old has passed away; behold, the new has come."},
 {r:"John 1:12",t:"Identity",x:"But to all who did receive him, who believed in his name, he gave the right to become children of God,"},
 {r:"Acts 4:12",t:"Salvation",x:"And there is salvation in no one else, for there is no other name under heaven given among men by which we must be saved."},
 {r:"John 14:6",t:"Jesus",x:"Jesus said to him, “I am the way, and the truth, and the life. No one comes to the Father except through me.”"},
 {r:"Philippians 4:6-7",t:"Peace",x:"do not be anxious about anything, but in everything by prayer and supplication with thanksgiving let your requests be made known to God. And the peace of God, which surpasses all understanding, will guard your hearts and your minds in Christ Jesus."},
 {r:"Philippians 4:13",t:"Strength",x:"I can do all things through him who strengthens me."},
 {r:"Proverbs 3:5-6",t:"Trust",x:"Trust in the LORD with all your heart, and do not lean on your own understanding. In all your ways acknowledge him, and he will make straight your paths."},
 {r:"Matthew 6:33",t:"Priorities",x:"But seek first the kingdom of God and his righteousness, and all these things will be added to you."},
 {r:"1 Peter 5:7",t:"Peace",x:"casting all your anxieties on him, because he cares for you."},
 {r:"Isaiah 41:10",t:"Courage",x:"fear not, for I am with you; be not dismayed, for I am your God; I will strengthen you, I will help you, I will uphold you with my righteous right hand."},
 {r:"Psalm 23:1",t:"Trust",x:"The LORD is my shepherd; I shall not want."},
 {r:"Matthew 11:28",t:"Rest",x:"Come to me, all who labor and are heavy laden, and I will give you rest."},
 {r:"Psalm 46:1",t:"Strength",x:"God is our refuge and strength, a very present help in trouble."},
 {r:"Joshua 1:9",t:"Courage",x:"Have I not commanded you? Be strong and courageous. Do not be frightened, and do not be dismayed, for the LORD your God is with you wherever you go."},
 {r:"Galatians 2:20",t:"Identity",x:"I have been crucified with Christ. It is no longer I who live, but Christ who lives in me. And the life I now live in the flesh I live by faith in the Son of God, who loved me and gave himself for me."},
 {r:"Romans 12:1",t:"Discipleship",x:"I appeal to you therefore, brothers, by the mercies of God, to present your bodies as a living sacrifice, holy and acceptable to God, which is your spiritual worship."},
 {r:"Romans 12:2",t:"Transformation",x:"Do not be conformed to this world, but be transformed by the renewal of your mind, that by testing you may discern what is the will of God, what is good and acceptable and perfect."},
 {r:"Galatians 5:22-23",t:"Character",x:"But the fruit of the Spirit is love, joy, peace, patience, kindness, goodness, faithfulness, gentleness, self-control; against such things there is no law."},
 {r:"Colossians 3:23",t:"Work",x:"Whatever you do, work heartily, as for the Lord and not for men,"},
 {r:"Micah 6:8",t:"Justice",x:"He has told you, O man, what is good; and what does the LORD require of you but to do justice, and to love kindness, and to walk humbly with your God?"},
 {r:"2 Timothy 1:7",t:"Courage",x:"for God gave us a spirit not of fear but of power and love and self-control."},
 {r:"1 Corinthians 10:13",t:"Temptation",x:"No temptation has overtaken you that is not common to man. God is faithful, and he will not let you be tempted beyond your ability, but with the temptation he will also provide the way of escape, that you may be able to endure it."},
 {r:"James 1:22",t:"Obedience",x:"But be doers of the word, and not hearers only, deceiving yourselves."},
 {r:"2 Timothy 3:16",t:"Scripture",x:"All Scripture is breathed out by God and profitable for teaching, for reproof, for correction, and for training in righteousness,"},
 {r:"Psalm 119:11",t:"Scripture",x:"I have stored up your word in my heart, that I might not sin against you."},
 {r:"Hebrews 4:12",t:"Scripture",x:"For the word of God is living and active, sharper than any two-edged sword, piercing to the division of soul and of spirit, of joints and of marrow, and discerning the thoughts and intentions of the heart."},
 {r:"Joshua 1:8",t:"Scripture",x:"This Book of the Law shall not depart from your mouth, but you shall meditate on it day and night, so that you may be careful to do according to all that is written in it. For then you will make your way prosperous, and then you will have good success."},
 {r:"Psalm 1:1-2",t:"Scripture",x:"Blessed is the man who walks not in the counsel of the wicked, nor stands in the way of sinners, nor sits in the seat of scoffers; but his delight is in the law of the LORD, and on his law he meditates day and night."},
 {r:"Isaiah 40:31",t:"Strength",x:"but they who wait for the LORD shall renew their strength; they shall mount up with wings like eagles; they shall run and not be weary; they shall walk and not faint."},
 {r:"Jeremiah 29:11",t:"Hope",x:"For I know the plans I have for you, declares the LORD, plans for welfare and not for evil, to give you a future and a hope."},
 {r:"Romans 8:28",t:"Hope",x:"And we know that for those who love God all things work together for good, for those who are called according to his purpose."},
 {r:"Romans 8:38-39",t:"Assurance",x:"For I am sure that neither death nor life, nor angels nor rulers, nor things present nor things to come, nor powers, nor height nor depth, nor anything else in all creation, will be able to separate us from the love of God in Christ Jesus our Lord."},
 {r:"Lamentations 3:22-23",t:"Faithfulness",x:"The steadfast love of the LORD never ceases; his mercies never come to an end; they are new every morning; great is your faithfulness."},
 {r:"1 Corinthians 13:4-5",t:"Love",x:"Love is patient and kind; love does not envy or boast; it is not arrogant or rude. It does not insist on its own way; it is not irritable or resentful;"},
 {r:"John 13:34-35",t:"Love",x:"A new commandment I give to you, that you love one another: just as I have loved you, you also are to love one another. By this all people will know that you are my disciples, if you have love for one another."},
 {r:"Matthew 28:19-20",t:"Mission",x:"Go therefore and make disciples of all nations, baptizing them in the name of the Father and of the Son and of the Holy Spirit, teaching them to observe all that I have commanded you. And behold, I am with you always, to the end of the age."},
 {r:"1 John 1:9",t:"Forgiveness",x:"If we confess our sins, he is faithful and just to forgive us our sins and to cleanse us from all unrighteousness."},
 {r:"Galatians 6:9",t:"Perseverance",x:"And let us not grow weary of doing good, for in due season we will reap, if we do not give up."},
 {r:"Ephesians 4:32",t:"Forgiveness",x:"Be kind to one another, tenderhearted, forgiving one another, as God in Christ forgave you."},
 {r:"Philippians 2:3-4",t:"Humility",x:"Do nothing from selfish ambition or conceit, but in humility count others more significant than yourselves. Let each of you look not only to his own interests, but also to the interests of others."},
 {r:"Colossians 3:12",t:"Character",x:"Put on then, as God's chosen ones, holy and beloved, compassionate hearts, kindness, humility, meekness, and patience,"},
 {r:"1 John 4:19",t:"Love",x:"We love because he first loved us."},
 {r:"Matthew 5:16",t:"Witness",x:"In the same way, let your light shine before others, so that they may see your good works and give glory to your Father who is in heaven."},
 {r:"John 10:10",t:"Life",x:"The thief comes only to steal and kill and destroy. I came that they may have life and have it abundantly."},
 {r:"Hebrews 11:1",t:"Faith",x:"Now faith is the assurance of things hoped for, the conviction of things not seen."},
 {r:"Revelation 3:20",t:"Invitation",x:"Behold, I stand at the door and knock. If anyone hears my voice and opens the door, I will come in to him and eat with him, and he with me."}
];

const NT = [
 ["Matthew",28],["Mark",16],["Luke",24],["John",21],["Acts",28],["Romans",16],
 ["1 Corinthians",16],["2 Corinthians",13],["Galatians",6],["Ephesians",6],
 ["Philippians",4],["Colossians",4],["1 Thessalonians",5],["2 Thessalonians",3],
 ["1 Timothy",6],["2 Timothy",4],["Titus",3],["Philemon",1],["Hebrews",13],
 ["James",5],["1 Peter",5],["2 Peter",3],["1 John",5],["2 John",1],["3 John",1],
 ["Jude",1],["Revelation",22]
];
const NT_SEQ = [];
NT.forEach(([book,ch]) => { for(let i=1;i<=ch;i++) NT_SEQ.push(book+" "+i); });

const KEY = "morningword.v1";

/* ---- pure helpers ---- */
function todayStr(d){ d = d || new Date(); return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0"); }
function parseStr(s){ const [y,m,d]=s.split("-").map(Number); return new Date(y,m-1,d); }
function daysBetween(a,b){ return Math.round((parseStr(b)-parseStr(a))/86400000); }
function fmtDate(s){ return parseStr(s).toLocaleDateString(undefined,{weekday:"long",month:"long",day:"numeric"}); }
function esvUrl(passage){ return "https://www.esv.org/"+encodeURIComponent(passage.replace(/\s+/g,"+"))+"/"; }
function tokenize(text){ return text.match(/[A-Za-z’']+|[^A-Za-z’'\s]+/g) || []; }
function isWord(tok){ return /[A-Za-z]/.test(tok); }
function normWord(w){ return w.toLowerCase().replace(/[^a-z’']/g,"").replace(/’/g,"'"); }

function defaultState(){ return { start: todayStr(), completed:{}, learned:{}, reviews:{} }; }
function loadState(){
  try{ const s = JSON.parse(localStorage.getItem(KEY)); if(s){ return { start:s.start||todayStr(), completed:s.completed||{}, learned:s.learned||{}, reviews:s.reviews||{} }; } }catch(e){}
  return defaultState();
}

function dayIndex(start){ return Math.max(0, daysBetween(start, todayStr())); }
function weekIndex(start){ return Math.floor(dayIndex(start)/7); }
function computeStreak(completed){
  let streak=0; let cursor=new Date();
  if(!completed[todayStr(cursor)]) cursor.setDate(cursor.getDate()-1);
  while(completed[todayStr(cursor)]){ streak++; cursor.setDate(cursor.getDate()-1); }
  return streak;
}
function gradeTest(input, vx){
  const ref = tokenize(vx).filter(isWord).map(normWord);
  const got = tokenize(input).filter(isWord).map(normWord);
  const m=ref.length, n=got.length;
  const dp = Array.from({length:m+1},()=>new Array(n+1).fill(0));
  for(let i=1;i<=m;i++) for(let j=1;j<=n;j++){ dp[i][j] = ref[i-1]===got[j-1] ? dp[i-1][j-1]+1 : Math.max(dp[i-1][j],dp[i][j-1]); }
  let i=m,j=n; const matched=new Array(m).fill(false);
  while(i>0&&j>0){ if(ref[i-1]===got[j-1]){matched[i-1]=true;i--;j--;} else if(dp[i-1][j]>=dp[i][j-1])i--; else j--; }
  const correct = matched.filter(Boolean).length;
  const pct = m ? Math.round(correct/m*100) : 0;
  return { pct, matched };
}

const CSS = `
#mw-root{--bg:#f7f4ee;--card:#fffdf9;--ink:#2b2723;--muted:#7c7468;--line:#e7e0d4;--accent:#8a6d3b;--accent2:#b08d57;--good:#4d7c4d;--gold:#c9a14a;--shadow:0 1px 3px rgba(60,50,30,.08),0 8px 24px rgba(60,50,30,.06);--serif:"Iowan Old Style","Palatino Linotype",Palatino,Georgia,"Times New Roman",serif;--sans:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;
  background:var(--bg);color:var(--ink);font-family:var(--sans);line-height:1.55;border-radius:16px;padding:18px;max-width:780px;}
#mw-root *{box-sizing:border-box;}
#mw-root .head{display:flex;align-items:baseline;justify-content:space-between;gap:12px;margin-bottom:12px;flex-wrap:wrap;}
#mw-root .brand{font-family:var(--serif);font-size:24px;font-weight:600;}
#mw-root .brand .sub{display:block;font-family:var(--sans);font-size:11.5px;color:var(--muted);font-weight:500;letter-spacing:.4px;text-transform:uppercase;margin-top:2px;}
#mw-root .datechip{font-size:13px;color:var(--muted);text-align:right;}
#mw-root .streak{display:inline-flex;align-items:center;gap:6px;background:#fff;border:1px solid var(--line);border-radius:999px;padding:5px 12px;font-size:13px;font-weight:600;color:var(--accent);box-shadow:var(--shadow);}
#mw-root .tabs{display:flex;gap:4px;background:#efe9dd;border-radius:12px;padding:4px;margin:6px 0 16px;box-shadow:var(--shadow);}
#mw-root .tabs button{flex:1;border:0;background:transparent;color:var(--muted);font-size:13px;font-weight:600;padding:9px 6px;border-radius:9px;cursor:pointer;font-family:var(--sans);}
#mw-root .tabs button.active{background:var(--card);color:var(--ink);box-shadow:var(--shadow);}
#mw-root .card{background:var(--card);border:1px solid var(--line);border-radius:16px;padding:20px;box-shadow:var(--shadow);margin-bottom:16px;}
#mw-root .card h2{margin:0 0 4px;font-family:var(--serif);font-size:20px;font-weight:600;}
#mw-root .eyebrow{font-size:11.5px;letter-spacing:1px;text-transform:uppercase;color:var(--accent2);font-weight:700;margin-bottom:8px;}
#mw-root .verse{font-family:var(--serif);font-size:22px;line-height:1.5;margin:6px 0 10px;}
#mw-root .ref{font-weight:600;color:var(--accent);font-size:15px;font-family:var(--sans);}
#mw-root .theme-tag{display:inline-block;font-size:11px;background:#f0e8d8;color:var(--accent);border-radius:999px;padding:3px 10px;font-weight:600;margin-left:8px;vertical-align:middle;}
#mw-root .reading-row{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:14px 0;border-bottom:1px solid var(--line);}
#mw-root .reading-row:last-child{border-bottom:0;}
#mw-root .reading-row .label{font-size:12px;color:var(--muted);text-transform:uppercase;letter-spacing:.6px;font-weight:700;}
#mw-root .reading-row .passage{font-family:var(--serif);font-size:19px;font-weight:600;}
#mw-root .btn{display:inline-block;border:1px solid var(--accent2);background:var(--accent);color:#fff;font-weight:600;font-size:13.5px;padding:8px 14px;border-radius:9px;cursor:pointer;text-decoration:none;font-family:var(--sans);}
#mw-root .btn:hover{background:#735a30;}
#mw-root .btn.ghost{background:transparent;color:var(--accent);border-color:var(--line);}
#mw-root .btn.ghost:hover{background:#f3ecdd;}
#mw-root .btn.sm{font-size:12.5px;padding:6px 11px;}
#mw-root .btn.good{background:var(--good);border-color:var(--good);}
#mw-root .btn.good:hover{background:#3c6b3c;}
#mw-root .btn:disabled{opacity:.5;cursor:default;}
#mw-root .controls{display:flex;gap:8px;flex-wrap:wrap;margin-top:8px;}
#mw-root .muted{color:var(--muted);font-size:13.5px;}
#mw-root .mem-modes{display:flex;gap:6px;flex-wrap:wrap;margin:0 0 14px;}
#mw-root .mem-modes button{border:1px solid var(--line);background:#fff;color:var(--muted);font-weight:600;font-size:12.5px;padding:7px 12px;border-radius:999px;cursor:pointer;}
#mw-root .mem-modes button.active{background:var(--accent);color:#fff;border-color:var(--accent);}
#mw-root .mem-stage{min-height:110px;font-family:var(--serif);font-size:21px;line-height:1.6;margin:8px 0 8px;}
#mw-root .hint{font-family:var(--sans);font-size:13px;color:var(--muted);margin-top:10px;}
#mw-root .word.blank{display:inline-block;min-width:1.6em;border-bottom:2px solid var(--accent2);color:transparent;cursor:pointer;}
#mw-root .word.blank.shown{color:var(--ink);border-bottom-color:transparent;}
#mw-root textarea.test{width:100%;min-height:90px;border:1px solid var(--line);border-radius:10px;padding:12px;font-family:var(--serif);font-size:17px;resize:vertical;background:#fff;color:var(--ink);}
#mw-root .diff{font-family:var(--serif);font-size:19px;line-height:1.6;margin-top:12px;}
#mw-root .diff .ok{color:var(--good);}
#mw-root .diff .miss{color:#b23b3b;background:#fbeaea;border-radius:3px;padding:0 2px;}
#mw-root .scorebar{font-weight:600;margin-top:8px;}
#mw-root .progress-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:12px;margin-top:4px;}
#mw-root .stat{background:#fff;border:1px solid var(--line);border-radius:12px;padding:14px;}
#mw-root .stat .n{font-size:26px;font-weight:700;font-family:var(--serif);color:var(--accent);}
#mw-root .stat .l{font-size:12px;color:var(--muted);text-transform:uppercase;letter-spacing:.5px;font-weight:600;}
#mw-root .review-item{display:flex;align-items:flex-start;gap:12px;padding:14px 0;border-bottom:1px solid var(--line);}
#mw-root .review-item:last-child{border-bottom:0;}
#mw-root .review-item .vtext{flex:1;font-family:var(--serif);font-size:16px;}
#mw-root .review-item .vref{font-size:13px;color:var(--accent);font-weight:600;margin-bottom:3px;font-family:var(--sans);}
#mw-root .dot{width:10px;height:10px;border-radius:50%;margin-top:7px;flex-shrink:0;background:var(--line);}
#mw-root .dot.learned{background:var(--good);}
#mw-root .dot.current{background:var(--gold);box-shadow:0 0 0 3px #f6ecc8;}
#mw-root .plan-week{padding:12px 0;border-bottom:1px solid var(--line);}
#mw-root .plan-week:last-child{border-bottom:0;}
#mw-root .plan-week.now{background:#fbf6ea;border-radius:10px;padding:12px;margin:0 -8px;}
#mw-root .wk{font-size:12px;color:var(--muted);font-weight:700;text-transform:uppercase;letter-spacing:.5px;}
#mw-root .row-split{display:flex;justify-content:space-between;align-items:center;gap:10px;}
#mw-root .pill-done{background:var(--good);color:#fff;border-radius:999px;padding:4px 12px;font-size:12.5px;font-weight:600;}
#mw-root input[type=date]{border:1px solid var(--line);border-radius:8px;padding:7px 10px;font-family:var(--sans);font-size:14px;background:#fff;color:var(--ink);}
#mw-root .foot{font-size:11.5px;color:var(--muted);text-align:center;margin-top:8px;line-height:1.6;}
`;

const TABS = [["today","Today"],["memorize","Memorize"],["review","Review"],["plan","Plan"],["settings","Settings"]];

export default function ScripturePage(){
  const [mounted,setMounted] = useState(false);
  const [state,setState] = useState(defaultState);
  const [tab,setTab] = useState("today");
  const [memMode,setMemMode] = useState("read");
  const [blanksLevel,setBlanksLevel] = useState(0);
  const [revealFL,setRevealFL] = useState(false);
  const [shownBlanks,setShownBlanks] = useState({});
  const [testInput,setTestInput] = useState("");
  const [testResult,setTestResult] = useState(null);
  const [dateField,setDateField] = useState("");

  useEffect(()=>{ const s=loadState(); setState(s); setDateField(s.start); setMounted(true); },[]);
  useEffect(()=>{ if(mounted){ try{ localStorage.setItem(KEY, JSON.stringify(state)); }catch(e){} } },[state,mounted]);

  const di = dayIndex(state.start);
  const wi = weekIndex(state.start);
  const vIdx = wi % VERSES.length;
  const v = VERSES[vIdx];
  const streak = useMemo(()=>computeStreak(state.completed),[state.completed]);
  const today = todayStr();
  const nt = NT_SEQ[di % NT_SEQ.length];
  const ps = "Psalm " + ((di % 150) + 1);
  const learnedCount = Object.keys(state.learned).length;

  function resetMem(){ setMemMode("read"); setBlanksLevel(0); setRevealFL(false); setShownBlanks({}); setTestInput(""); setTestResult(null); }
  function changeMode(m){ setMemMode(m); setRevealFL(false); setShownBlanks({}); if(m!=="blanks") setBlanksLevel(0); }

  if(!mounted){
    return <div id="mw-root"><style dangerouslySetInnerHTML={{__html:CSS}} /><div className="muted">Loading...</div></div>;
  }

  /* ---- memorize stage rendering ---- */
  const toks = tokenize(v.x);
  function firstLetters(){
    return toks.map(tk => isWord(tk) ? tk[0] : tk).join(" ").replace(/\s+([^A-Za-z0-9])/g,"$1");
  }
  function blankSet(){
    const wordIdx=[]; toks.forEach((tk,i)=>{ if(isWord(tk)) wordIdx.push(i); });
    const fracs=[0.25,0.5,0.75,1]; const frac=fracs[Math.min(blanksLevel,3)];
    const nHide=Math.round(wordIdx.length*frac); const step=wordIdx.length/Math.max(1,nHide);
    const set=new Set(); for(let k=0;k<nHide;k++){ set.add(wordIdx[Math.floor(k*step)]); }
    return set;
  }
  function runTest(){ setTestResult(gradeTest(testInput, v.x)); }

  return (
    <div id="mw-root">
      <style dangerouslySetInnerHTML={{__html:CSS}} />

      <div className="head">
        <div className="brand">Morning Word<span className="sub">15-minute Bible reading &amp; Scripture memory · ESV</span></div>
        <div className="datechip">
          <div>{fmtDate(today)}</div>
          <div style={{marginTop:6}}><span className="streak">{"🔥 " + streak + " day" + (streak===1?"":"s") + " streak"}</span></div>
        </div>
      </div>

      <div className="tabs">
        {TABS.map(([id,label]) => (
          <button key={id} className={tab===id?"active":""} onClick={()=>setTab(id)}>{label}</button>
        ))}
      </div>

      {tab==="today" && (
        <div>
          <div className="card">
            <div className="eyebrow">This week's memory verse · Week {wi+1}</div>
            <div className="verse">{"“"+v.x+"”"}</div>
            <div><span className="ref">{v.r} (ESV)</span><span className="theme-tag">{v.t}</span></div>
            <div className="controls">
              <button className="btn sm" onClick={()=>{resetMem();setTab("memorize");}}>Practice memorizing &rarr;</button>
              <a className="btn ghost sm" href={esvUrl(v.r)} target="_blank" rel="noopener noreferrer">Read in context</a>
            </div>
          </div>

          <div className="card">
            <div className="eyebrow">Today's reading · about 8–10 minutes</div>
            <div className="reading-row">
              <div><div className="label">New Testament</div><div className="passage">{nt}</div></div>
              <a className="btn sm" href={esvUrl(nt)} target="_blank" rel="noopener noreferrer">Read</a>
            </div>
            <div className="reading-row">
              <div><div className="label">Psalm</div><div className="passage">{ps}</div></div>
              <a className="btn sm" href={esvUrl(ps)} target="_blank" rel="noopener noreferrer">Read</a>
            </div>
          </div>

          <div className="card">
            <div className="eyebrow">Finish your time</div>
            {state.completed[today] ? (
              <div>
                <div className="controls" style={{marginTop:0}}>
                  <span className="pill-done">✓ Today complete</span>
                  <button className="btn ghost sm" onClick={()=>setState(s=>{ const c={...s.completed}; delete c[today]; return {...s,completed:c}; })}>Undo</button>
                </div>
                <p className="muted" style={{margin:"12px 0 0"}}>Well done. “His mercies are new every morning.” See you tomorrow.</p>
              </div>
            ) : (
              <div>
                <button className="btn good" onClick={()=>setState(s=>({...s,completed:{...s.completed,[today]:true}}))}>✓ Mark today complete</button>
                <p className="muted" style={{margin:"12px 0 0"}}>Read both passages and spend a few minutes on your memory verse, then mark your morning complete to build your streak.</p>
              </div>
            )}
          </div>
        </div>
      )}

      {tab==="memorize" && (
        <div>
          <div className="card">
            <div className="eyebrow">Memorize · Week {wi+1} <span className="theme-tag">{v.t}</span></div>
            <div className="ref" style={{fontSize:16,marginBottom:10}}>{v.r} (ESV)</div>
            <div className="mem-modes">
              {[["read","1 · Read"],["firstletter","2 · First letters"],["blanks","3 · Fill blanks"],["test","4 · Test yourself"]].map(([m,lbl])=>(
                <button key={m} className={memMode===m?"active":""} onClick={()=>changeMode(m)}>{lbl}</button>
              ))}
            </div>

            <div className="mem-stage">
              {memMode==="read" && (<div>{"“"+v.x+"”"}<div className="hint">Read it aloud slowly 3 times. Notice the flow of ideas, then move to step 2.</div></div>)}

              {memMode==="firstletter" && (
                <div>
                  <div>{revealFL ? "“"+v.x+"”" : firstLetters()}</div>
                  <div className="hint">Each letter is the first letter of a word. Recite the full verse from memory using these cues.</div>
                </div>
              )}

              {memMode==="blanks" && (() => { const set=blankSet(); return (
                <div>
                  <span>{"“"}</span>
                  {toks.map((tk,i)=>{
                    const space = i>0 && isWord(tk) ? " " : (i>0 && !/^[.,;:!?’')”]/.test(tk) ? " " : "");
                    if(isWord(tk) && set.has(i)){
                      const shown=!!shownBlanks[i];
                      return <span key={i}>{space}<span className={"word blank"+(shown?" shown":"")} onClick={()=>setShownBlanks(o=>({...o,[i]:!o[i]}))}>{shown?tk:tk}</span></span>;
                    }
                    return <span key={i}>{space}{tk}</span>;
                  })}
                  <span>{"”"}</span>
                  <div className="hint">Fill in the blanks in your mind; tap any blank to check it. Hide more each round.</div>
                </div>
              ); })()}

              {memMode==="test" && (
                <div>
                  <textarea className="test" placeholder="Type the verse from memory..." value={testInput} onChange={e=>setTestInput(e.target.value)} />
                  {testResult && (() => {
                    let wi2=0; const pct=testResult.pct;
                    const msg = pct===100?"Perfect — word for word!":pct>=85?"Very close! Check the highlighted words.":pct>=50?"Good progress — keep at it.":"Keep working through the earlier steps.";
                    return (
                      <div>
                        <div className="scorebar" style={{color: pct>=85?"var(--good)":"var(--accent)"}}>{pct}% recalled — {msg}</div>
                        <div className="diff">{"“"}{toks.map((tk,i)=>{
                          const space = i>0 ? (isWord(tk) ? " " : (/^[.,;:!?’')”]/.test(tk) ? "" : " ")) : "";
                          if(isWord(tk)){ const ok=testResult.matched[wi2++]; return <span key={i}>{space}<span className={ok?"ok":"miss"}>{tk}</span></span>; }
                          return <span key={i}>{space}{tk}</span>;
                        })}{"”"}</div>
                      </div>
                    );
                  })()}
                </div>
              )}
            </div>

            <div className="controls">
              {memMode==="firstletter" && <button className="btn ghost sm" onClick={()=>setRevealFL(true)}>Reveal full verse</button>}
              {memMode==="blanks" && <>
                <button className="btn sm" onClick={()=>setBlanksLevel(l=>Math.min(3,l+1))}>Hide more words</button>
                <button className="btn ghost sm" onClick={()=>setBlanksLevel(l=>Math.max(0,l-1))}>Hide fewer</button>
                <button className="btn ghost sm" onClick={()=>{ const all={}; blankSet().forEach(i=>all[i]=true); setShownBlanks(all); }}>Reveal all</button>
              </>}
              {memMode==="test" && <>
                <button className="btn good sm" onClick={runTest}>Check my answer</button>
                <button className="btn ghost sm" onClick={()=>{setTestInput("");setTestResult(null);}}>Clear</button>
              </>}
            </div>
          </div>

          <div className="card">
            <div className="row-split">
              <div>
                <strong>Mark this verse memorized</strong>
                <div className="muted">It moves into your review rotation.</div>
              </div>
              {state.learned[vIdx]
                ? <button className="btn" disabled>✓ Memorized</button>
                : <button className="btn good" onClick={()=>setState(s=>({...s,learned:{...s.learned,[vIdx]:today}}))}>I know it</button>}
            </div>
          </div>
        </div>
      )}

      {tab==="review" && (() => {
        const learnedIdx = Object.keys(state.learned).map(Number).sort((a,b)=>a-b);
        const isDue = (idx) => { const last = state.reviews[idx] || state.learned[idx]; return daysBetween(last, today) >= 1 && state.reviews[idx] !== today; };
        const due = learnedIdx.filter(isDue);
        return (
          <div>
            <div className="card">
              <div className="eyebrow">Spaced review</div>
              <h2>{learnedIdx.length===0 ? "Nothing due yet" : due.length===0 ? "All caught up" : (due.length+" verse"+(due.length===1?"":"s")+" due today")}</h2>
              <p className="muted">Reviewing on a 1 · 3 · 7 · 14 · 30-day rhythm keeps verses from fading. Reveal to check your recall, then mark it.</p>
              {learnedIdx.length===0 && <p className="muted">No verses memorized yet. Head to the Memorize tab and mark this week's verse “I know it” to start your review rotation.</p>}
              {learnedIdx.length>0 && due.length===0 && <p className="muted">✓ All caught up — no reviews due today. Come back tomorrow.</p>}
              {due.map(idx => <ReviewCard key={idx} idx={idx} onGot={()=>setState(s=>({...s,reviews:{...s.reviews,[idx]:today}}))} />)}
            </div>

            <div className="card">
              <div className="eyebrow">All verses</div>
              <h2>Your 52-verse journey</h2>
              {VERSES.map((vv,idx)=>(
                <div className="review-item" key={idx}>
                  <div className={"dot"+(state.learned[idx]?" learned":"")+(idx===vIdx?" current":"")}></div>
                  <div className="vtext">
                    <div className="vref">{vv.r}{state.learned[idx]?" ✓":""}{idx===vIdx?" · this week":""}</div>
                    {vv.x}
                  </div>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {tab==="plan" && (
        <div>
          <div className="card">
            <div className="eyebrow">The plan</div>
            <h2>How it works</h2>
            <p className="muted">Each morning takes about 15 minutes: read one New Testament chapter and one Psalm (~8–10 min), then spend ~5 min on the week's memory verse. You memorize one verse per week — 52 verses a year — and review past verses on a spaced schedule so they stick.</p>
            <p className="muted">The reading walks straight through the New Testament one chapter at a time, with a Psalm alongside it each day. When you reach the end, it loops so you're always in the Word.</p>
          </div>
          <div className="card">
            <div className="eyebrow">Upcoming memory verses</div>
            {Array.from({length:8}).map((_,k)=>{ const w=wi+k; const vv=VERSES[w%VERSES.length]; return (
              <div className={"plan-week"+(k===0?" now":"")} key={k}>
                <div className="wk">Week {w+1}{k===0?" · this week":""}</div>
                <div className="row-split"><div><span className="ref">{vv.r}</span> <span className="theme-tag">{vv.t}</span></div></div>
                <div className="muted" style={{marginTop:4}}>{"“"+(vv.x.length>90?vv.x.slice(0,90)+"…":vv.x)+"”"}</div>
              </div>
            ); })}
          </div>
        </div>
      )}

      {tab==="settings" && (
        <div>
          <div className="card">
            <div className="progress-grid" style={{marginBottom:18}}>
              <div className="stat"><div className="n">{streak}</div><div className="l">Day streak</div></div>
              <div className="stat"><div className="n">{Object.keys(state.completed).length}</div><div className="l">Days complete</div></div>
              <div className="stat"><div className="n">{learnedCount}</div><div className="l">Verses memorized</div></div>
              <div className="stat"><div className="n">{wi+1}</div><div className="l">Current week</div></div>
            </div>
            <div className="eyebrow">Your plan start date</div>
            <h2>Day &amp; week numbering</h2>
            <p className="muted">This sets which reading and memory verse counts as “Day 1.” Day and week numbers count forward from here.</p>
            <div style={{display:"flex",alignItems:"center",gap:10,margin:"10px 0"}}>
              <strong>Start date:</strong>
              <input type="date" value={dateField} onChange={e=>setDateField(e.target.value)} />
            </div>
            <div className="controls">
              <button className="btn sm" onClick={()=>{ if(dateField){ setState(s=>({...s,start:dateField})); setTab("today"); } }}>Save</button>
              <button className="btn ghost sm" onClick={()=>setDateField(today)}>Set to today</button>
            </div>
          </div>
          <div className="card">
            <div className="eyebrow">Data</div>
            <p className="muted">Your streak, completed days, and memorized verses are saved on this device/browser.</p>
            <button className="btn ghost sm" onClick={()=>{ if(confirm("Reset all progress, streak, and memorized verses? This cannot be undone.")){ const fresh=defaultState(); setState(fresh); setDateField(fresh.start); setTab("today"); } }}>Reset all progress</button>
          </div>
        </div>
      )}

      <div className="foot">
        Scripture quotations are from the ESV® Bible (The Holy Bible, English Standard Version®), © 2001 by Crossway. Used by permission. All rights reserved. “Read” links open the full passage on esv.org.
      </div>
    </div>
  );
}

function ReviewCard({ idx, onGot }){
  const v = VERSES[idx];
  const [shown,setShown] = useState(false);
  return (
    <div className="review-item">
      <div className="dot learned"></div>
      <div className="vtext">
        <div className="vref">{v.r}</div>
        {shown ? <div>{v.x}</div> : <div className="muted">Recite it from memory, then reveal to check.</div>}
        <div className="controls" style={{marginTop:8}}>
          {!shown && <button className="btn ghost sm" onClick={()=>setShown(true)}>Reveal</button>}
          <button className="btn good sm" onClick={onGot}>✓ Got it</button>
        </div>
      </div>
    </div>
  );
}
