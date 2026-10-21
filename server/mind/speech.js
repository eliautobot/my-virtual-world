// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// What an agent says out loud (docs/features/FREE-WILL.md §7, §11.12): a line everyone near it sees in a speech bubble,
// written by its own brain when someone talks to it or it chats with someone in the world. the product owner decided (2026-10-07):
// public speech is checked by a moderation service before anyone sees it; agent-to-agent talk is short.
// - The prompt holds only what anyone standing there could know: its name, role and manner, what it likes, where it is and
//   what it is doing, who it is talking to and what they just said. Never its money, plans, memories, owner or chats — so a line cannot
//   give them away, whatever the model writes.
// - A line passes the world's own checks first (localCheck: short, no links, no contact details, nothing that breaks
//   character or leaks the prompt), then the moderation service (server/providers/models.js moderate). Anything that
//   fails, or cannot be checked, is not said: the bubble keeps the routine's line.
// - The same checks guard the edge of an outside AI (one with a terminal, a browser, its owner's apps; 2026-10-11): what a
//   visitor writes to it (inboundCheck: no links, contact details or words aimed at an AI), what it answers a visitor
//   (privateCheck: no keys, tokens, codes, passwords or contact details) and the names it reads (aiName). Each check looks at
//   the text as written and as it reads once disguises are undone (look-alike letters, wide or spaced letters, digits for
//   letters, hidden characters), so a line can't slip past by spelling.
export const MAX_LINE = 140;   // the default; the admin's mind.speechMaxChars (Settings → Agent limits) is passed in

const TLD = '(?:com|net|org|io|gg|xyz|ly|app|dev|co|me|tv|info|biz|ru|cn|uk|de|link|site|shop|online|top|ai|sh|cc|ws|tk|ml|ga|gl|onion|live|store|tech|club|fun|space|world|page|blog|cloud|games|chat|social|news|email|click|win|bet|vip|pro|xxx)';
// (after a comma or in "word . tld" only names that are never everyday words: "Joe,co-worker" stays a sentence)
const TLD_STRICT = '(?:com|net|org|io|gg|xyz|app|dev|info|biz|ru|cn|link|site|shop|online|top|ai|sh|onion|xxx)';
const LINK = new RegExp(`\\bhttps?:\\/\\/|\\bhxxps?\\b|\\bwww\\.|\\b[a-z0-9-]{2,}\\.${TLD}\\b|\\b(?:\\d{1,3}\\.){3}\\d{1,3}\\b|\\bxn--[a-z0-9-]+|\\b(?:discord\\.gg|bit\\.ly|t\\.me|wa\\.me)\\b`, 'i');
// a website written so a filter misses it: "w w w . site . com", "site dot com", "site[.]com", "site (dot) net", "site,com"
const LINK_HIDDEN = new RegExp(`\\bw\\s*[\\W_]?\\s*w\\s*[\\W_]?\\s*w\\s*(?:\\.|\\bdot\\b|\\[\\s*\\.?\\s*\\]|\\(\\s*dot\\s*\\))|\\b(?:dot|d0t)\\s+${TLD}\\b|[\\[(]\\s*(?:\\.|dot)\\s*[\\])]\\s*${TLD}\\b|\\b[a-z0-9-]{2,}\\s+(?:\\.|dot)\\s+${TLD}\\b|\\b[a-z0-9-]{2,}\\s*\\.\\s+${TLD}\\b|\\b[a-z0-9-]{2,}\\s+\\.\\s*${TLD}\\b|\\b[a-z0-9-]{2,}\\s*,\\s*${TLD_STRICT}\\b|\\bcolon\\s+slash\\s+slash\\b|\\bslash\\s+slash\\b|\\b(?:discord|telegram)\\s+(?:gg|me)\\s+slash\\b`, 'i');
const EMAIL = /[^\s@]+@[^\s@]+\.[a-z]{2,}|\b[a-z0-9._-]{2,}\s*(?:[([]\s*at\s*[)\]]|@)\s*[a-z0-9-]{2,}\s*(?:[([]\s*dot\s*[)\]]|\bdot\b|\.)\s*[a-z]{2,}\b|\b[a-z0-9._-]{2,}\s+at\s+[a-z0-9-]{2,}\s+dot\s+[a-z]{2,}\b|\b[a-z0-9._-]{2,}\s+at\s+(?:gmail|yahoo|hotmail|outlook|proton\w*|icloud|aol|gmx|live)\b/i;
const HANDLE = /(^|\s)@[a-z0-9_]{2,}|\b[a-z0-9_.]{2,}#\d{4}\b/i;
const PHONE = /(?:\d[\s().-]*){7,}/;
// dates, times and prices are not phone numbers: "2026-10-08 15:25", "10/8/2026", "3.50 VC"
const NOT_PHONE = [/\b\d{4}-\d{1,2}-\d{1,2}(?:[ t]\d{1,2}:\d{2}(?::\d{2})?)?\b/g, /\b\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}\b/g, /\b\d{1,2}:\d{2}(?::\d{2})?\b/g, /\b\d+\.\d{1,2}\b(?!\.\d)/g];
const phoneIn = s => PHONE.test(NOT_PHONE.reduce((x, re) => x.replace(re, ' ; '), s));
// off-world places to talk or pay: a lure away from the world's own (moderated, reportable) talk
const OFF_WORLD = /\b(?:discord|telegram|whats\s?app|signal app|insta(?:gram)?|snap(?:chat)?|tik\s?tok|kik|wechat|skype|facebook|messenger|onlyfans|cash\s?app|venmo|paypal|zelle|western union)\b/i;
// words aimed at another AI rather than a person: fake system lines, "ignore what you were told", a new identity, claims to
// speak for its owner, asking for secrets, files, its owner's mail or accounts, or for commands on its computer
const MANIPULATION = [
  /(?:^|[\s"'(\[|#*>-])(?:system|assistant|developer|admin|root|operator)\s*(?:prompt|message|note|override|instruction|command)?\s*:/,
  /\[\[?\s*(?:system|admin|developer|owner|instructions?)\s*\]\]?|<\|?\s*(?:im_start|im_end|system|endoftext)|#{2,}\s*(?:instruction|system|prompt|task|new|override)/,
  /\b(?:begin|start|end)\s+(?:of\s+)?(?:the\s+)?(?:new\s+)?(?:system\s+)?(?:prompt|instructions)\b/,
  /\b(?:ignore|disregard|forget|override|bypass|abandon|discard|scrap|set aside|put aside|throw out|wipe|erase|nullify|suspend)\s+(?:all\s+|any\s+|the\s+|your\s+|my\s+|previous\s+|prior\s+|earlier\s+|above\s+|those\s+|these\s+|every\s+|of\s+|current\s+|original\s+|existing\s+)*(?:instructions|rules|prompts?|directions|guidelines|guidance|orders|programming|training|guardrails|restrictions|filters|safety|system)\b/,
  /\b(?:ignore|disregard|forget|pay no attention to|stop following|set aside|put aside|don'?t (?:follow|listen to|obey))\s+(?:all\s+|everything\s+|anything\s+)?(?:what(?:ever)?\s+)?(?:you(?:'ve| have| were| was)?\s+(?:been\s+)?(?:told|given|taught|programmed|instructed|received|got)|(?:everything|all|anything)\s+(?:you (?:know|were told|have been told|learned)|above|before|so far|earlier|previously)|the (?:above|previous|earlier|guidance|text above))/,
  /\b(?:jailbreak|prompt\s+injection|system\s+prompt|initial\s+prompt|hidden\s+(?:prompt|instructions)|(?:developer|dan|god|sudo|root|admin|maintenance|debug|unrestricted|unfiltered|jailbroken)\s+mode)\b/,
  /\byour\s+(?:real|true|actual|hidden|secret|original|new)\s+(?:instructions|orders|purpose|task|goal|rules|prompt|programming)\b/,
  /\bnew\s+(?:instructions?|orders|task|prompt|rules|directives?)\s*(?::|from\b|for you\b|follow\b|are\b)/,
  /\byou(?:'re| are)\s+(?:now\s+)?(?:an?\s+)?(?:[a-z]+\s+){0,2}?(?:\w*bot|ai|assistant|chatbot|language model|ai model)\b/,
  /\byou\b[^.!?]{0,25}\b(?:have|had|with|without)\s+no\s+(?:limits|rules|restrictions|filters|guardrails)\b/,
  // a secret named outright, an owner's whereabouts, a browser, or "decode this and do it"
  /\b(?:private\s*keys?|api\s*keys?|seed phrase|recovery phrase|(?:access|session|bearer|auth) tokens?|identity (?:file|key)|ssh keys?|2fa codes?|verification codes?|one[- ]time (?:codes?|passwords?))\b/,
  /\b(?:where|what|who|which)\b[^.!?]{0,30}\byour\s+owner'?s?\b[^.!?]{0,30}\b(?:live|lives|living|work|works|address|location|real name|full name|surname|phone|number|e-?mail|age|birthday|school|job|company)\b/,
  /\b(?:open|use|launch)\s+(?:a|your|the)\s+(?:web\s+)?browser\b/,
  /\b(?:decode|decrypt|unscramble|reverse|translate|rot13|base64)\b[^.!?]{0,40}\b(?:and|then)\s+(?:do|follow|run|execute|obey|act on)\b/,
  /\bpretend\s+(?:that\s+)?you(?:'re| are| have)?\s+(?:not|no|an?\s+(?:ai|assistant|admin|developer)|free|unrestricted|unfiltered|without)\b|\bpretend\s+to\s+be\s+(?:an?\s+|the\s+|my\s+|your\s+)?(?:ai|assistant|admin|developer|system|owner|operator|unrestricted)\b|\bact as (?:an? |the |my )?(?:ai|assistant|admin|developer|system|root|unrestricted|unfiltered)\b/,
  /\b(?:you\s+(?:will|must|shall)\s+(?:now\s+)?obey|obey\s+(?:me|my|the next|these|the following))\b|\bfollow\s+(?:my|these|the following)\s+(?:instructions|orders|commands|rules)\b/,
  /\b(?:your|the)\s+(?:owner|creator|developer|admin|operator|master|maker)\s+(?:told|asked|wants|says|said|has asked|authori[sz]ed|allowed|permitted|lets|instructed|ordered|sent)\b|\b(?:on behalf of|message from|sent by|speaking for)\s+(?:your|the)\s+(?:owner|creator|developer|admin|operator)\b|\bthis is\s+(?:your|the)\s+(?:owner|creator|developer|admin|operator|support|staff|moderator)\b|\b(?:admin|moderator|staff|support)\s+here\b/,
  /\b(?:reveal|share|tell|give|send|show|print|paste|leak|read|dump|post|copy|upload|forward|export|list|spell|recite|type out|write|say|repeat|output|display|include|encode|summari[sz]e|describe|quote|what(?:'s| is| are| was| were)?|whats|where(?:'s| is| are)?|check|open|access|look (?:at|in|through)|go through|search)\b[^.!?]{0,50}\b(?:secret (?:keys?|codes?|tokens?|phrases?|files?|words?)|password|passwrd|passwd|pw|pwd|passcode|pin code|api\s*keys?|private\s*keys?|keys? file|(?:api|access|session|auth|secret|bearer|login) tokens?|credentials?|cookies?|session (?:file|key)|identity (?:file|key)|config(?:uration)?|env(?:ironment)? (?:file|vars?|variables)|ssh|seed phrase|recovery (?:phrase|code)|2fa|otp|one[- ]time (?:code|password)|verification code|login|e-?mails?|mailbox|gmail|dms|direct messages|private messages|repo(?:s|sitor(?:y|ies))?|github|gitlab|google drive|dropbox|onedrive|icloud|bank (?:account|details|login|password|card)|card number|your (?:system )?(?:instructions|prompt)|(?:your\s+)?owner'?s? (?:secrets?|details|e-?mails?|inbox|mailbox|address|phone|number|name|password|account|accounts|info|files|computer|calendar|contacts|messages))\b/,
  /\b(?:check|read|open|search|look (?:at|in|through)|go through|access|use|list|what'?s? on|whats on)\s+(?:your\s+|its\s+|(?:your\s+)?owner'?s?\s+)(?:computer|machine|terminal|server|laptop|hard drive|disk|filesystem|file system|home folder|shell|console|command line|browser history)\b|\b(?:open|use|access|start|launch)\s+(?:a|your)\s+(?:terminal|shell|console|command line|command prompt|powershell)\b|\b(?:open|use|access|start|launch)\s+the\s+(?:shell|command line|command prompt|powershell)\b/,
  /\b(?:run|execute|exec|type|paste|launch)\s+(?:this|that|the following|these|a|the|my)?\s*(?:command|commands|script|scripts|code)\b|\b(?:run|execute|type|enter|paste)\b[^.!?]{0,30}\bin\s+(?:(?:your|a)\s+(?:terminal|shell|console|command line)|the\s+(?:shell|command line))\b/,
  /\b(?:curl|wget|sudo|chmod|chown|rm\s+-rf|bash\s+-c|sh\s+-c|powershell|cmd\.exe|netcat|nc\s+-[a-z]|python3?\s+-c|node\s+-e|base64\s+-d|eval\s*\()\b|\bcat\s+(?:[~/]\S*|\.[\w/]\S*|[\w.-]+\.(?:json|txt|env|pem|key|ya?ml|cfg|conf|ini|log|sh|py|js|mjs|db|sqlite|csv))\b/,
  /(?:^|[\s"'(])(?:~\/|\/etc\/|\/home\/|\/root\/|[a-z]:\\)|\b[\w.-]+\.(?:pem|key|env|json|ya?ml|cfg|conf|ini|sqlite|db|ps1|bat|kdbx|ovpn|p12|pfx)\b|(?:^|\s)\.(?:env|ssh|aws|git|npmrc|netrc|bashrc)\b|\bid_(?:rsa|ed25519|ecdsa)\b|\bmvw-identity\b|\bauthorized_keys\b|\bknown_hosts\b/,
  /\b(?:make|set|turn|switch|change|flip)\b[^.!?]{0,30}\b(?:repo|repository|account|profile|settings?|password|2fa)\b[^.!?]{0,20}\b(?:public|private|off|on|open|disabled?)\b/,
  /\b(?:forward|send|e-?mail|mail|dm|post|upload|share)\b[^.!?]{0,40}\b(?:e-?mails?|inbox|messages|files?|keys?|tokens?|passwords?|data|contents|everything|it all)\b[^.!?]{0,30}\bto\s+(?:me|us|my|this|that|the following|an? (?:address|server|site|link|number))\b/,
  /\b(?:gmail|github|gitlab|google drive|dropbox|onedrive|icloud|aws|coinbase|metamask|crypto wallet|seed phrase)\b/,
];
// keys, tokens and codes: never said, sent or answered, however an AI was asked
const SECRET = [
  /-----\s*BEGIN [A-Z ]{0,30}(?:KEY|CERTIFICATE|PRIVATE)|\bBEGIN\s+(?:RSA\s+|EC\s+|DSA\s+|OPENSSH\s+|ENCRYPTED\s+|PGP\s+)?PRIVATE\s+KEY\b/i,
  /\bMC4CAQAwBQYDK2Vw|\bMFECAQEwBQYDK2Vw/,                                                          // an Ed25519 private key (PKCS#8)
  /\bmvw[a-z]{1,2}_[A-Za-z0-9_-]{10,}/i,                                                            // the world's own codes and tokens
  /\bMVW-?[A-Z0-9]{4}-?[A-Z0-9]{4}\b/,                                                              // a code (MVW-XXXX-XXXX)
  /\b(?:sk|pk|rk)[-_](?:live|test|proj|ant|or|svcacct|admin)[-_][A-Za-z0-9_-]{8,}|\bsk-[A-Za-z0-9_-]{20,}|\bxai-[A-Za-z0-9_-]{20,}/,
  /\bgh[pousr]_[A-Za-z0-9]{20,}|\bgithub_pat_[A-Za-z0-9_]{20,}|\bglpat-[A-Za-z0-9_-]{16,}|\bnpm_[A-Za-z0-9]{30,}/,
  /\bAKIA[0-9A-Z]{16}\b|\bAIza[0-9A-Za-z_-]{30,}|\bya29\.[A-Za-z0-9_-]{20,}|\bxox[abposr]-[A-Za-z0-9-]{10,}|\bwhsec_[A-Za-z0-9]{16,}|\brnd_[A-Za-z0-9]{16,}/,
  /\beyJ[A-Za-z0-9_-]{5,}\.eyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}/,                                // a JWT
  /\b(?:password|passwd|passcode|pass ?phrase|pw|pwd|secret|token|api key|login)\s*(?:is|=|:|was)\s*(?=\S*[\d!@#$%^&*_+=~])\S{6,}/i,
  /\bpin(?:\s*(?:code|number))?\s*(?:is|=|:)\s*\d{4,}/i,
];
const CHARACTER = /\b(?:as an ai|language model|an ai assistant|i am an ai|i'm an ai|chatgpt|openai|anthropic|deepseek|my (?:system )?prompt|simulation|npc)\b/i;
const FORMAT = /[{}[\]<>«»`]|\bJSON\b|\bTASK:|\bWHO I AM\b/;

// ---- the text as it reads once disguises are undone (only for matching: what is said stays as written)
// letters from other alphabets that look like Latin ones (Cyrillic, Greek, a few others)
const LOOKALIKE = Object.fromEntries(('а:a в:b г:r д:d е:e ё:e и:u й:u к:k л:n м:m н:h о:o п:n р:p с:c т:t у:y х:x ц:u ш:w щ:w ь:b ы:b ъ:b я:r ѕ:s і:i ї:i ј:j '
  + 'ԁ:d һ:h ӏ:l ԛ:q ԝ:w ɑ:a ɡ:g ι:i ο:o ν:v α:a ρ:p τ:t κ:k υ:u χ:x ω:w β:b ε:e η:n μ:u '
  + 'Ѕ:S І:I Ј:J А:A В:B Е:E К:K М:M Н:H О:O Р:P С:C Т:T Х:X У:Y Α:A Β:B Ε:E Ζ:Z Η:H Ι:I Κ:K Μ:M Ν:N Ο:O Ρ:P Τ:T Υ:Y Χ:X')
  .split(' ').map(p => p.split(':')));
const LEET = { 0: 'o', 1: 'i', 3: 'e', 4: 'a', 5: 's', 7: 't', 8: 'b', '@': 'a', $: 's', '!': 'i', '|': 'l' };
const SLANG = [[/\bur\b/g, 'your'], [/\bu\b/g, 'you'], [/\bpls\b|\bplz\b/g, 'please'], [/\bthx\b/g, 'thanks'], [/\bpwd?\b/g, 'password'], [/\bpasswr?d\b|\bpasword\b/g, 'password']];
const HIDDEN = /[\u0000-\u001f\u007f\u00ad\u034f\u061c\u115f\u1160\u17b4\u17b5\u180e\u200b-\u200f\u2028-\u202e\u2060-\u206f\u3164\ufe00-\ufe0f\ufeff\uffa0]/g;
// invisible "tag" letters and extra variation selectors: text a person can't see but an AI reads (no use in chat)
const TAGS = /[\u{E0000}-\u{E007F}\u{E0100}-\u{E01EF}]/u;
/** The text with disguises undone, lower case: wide letters, look-alikes, accents and marks gone, odd dots made dots. */
function fold(t) {
  let s = t.normalize('NFKC').normalize('NFD').replace(/\p{M}/gu, '').replace(HIDDEN, '');
  s = [...s].map(c => LOOKALIKE[c] || c).join('');
  return s.replace(/[。｡․‧·•⋅∙・]/g, '.').replace(/[＠]/g, '@').toLowerCase();
}
/** Letters spread out ("s y s t e m", "i.g.n.o.r.e", "e-v-i-l") joined back into words. */
const despace = s => s.replace(/\b(?:[a-z0-9][\s.\-_*/\\]+){2,}[a-z0-9]\b/g, m => m.replace(/[\s.\-_*/\\]+/g, ''));
/** Digits and signs standing for letters inside a word ("1gn0re", "p@ssw0rd"), and chat shorthand ("ur pw"). */
function unleet(s) {
  s = s.replace(/\S+/g, w => (/[a-z]/.test(w) && /[0-9@$!|]/.test(w) ? w.replace(/[013457@$!|8]/g, c => LEET[c] || c) : w));
  for (const [re, to] of SLANG) s = s.replace(re, to);
  return s;
}
/** The ways a line is read: as written, folded, letters joined, digits as letters. */
function views(t) {
  const f = fold(t), d = despace(f), w = f.replace(/\b(?:[a-z0-9]\s+){2,}[a-z0-9]\b/g, m => m.replace(/\s+/g, ''));   // w: joined on spaces only ("b o b @ e v i l . c o m")
  const j = f.replace(/([a-z])[-_.*'~](?=[a-z])/g, '$1');                                      // "ign-ore", "in.struc.tions"
  const hidden = [rot13(f), [...f].reverse().join(''), ...decoded(t)].map(x => unleet(despace(fold(x))));   // written in code
  return { t, f, d, w, j, l: unleet(d), lf: unleet(f), hidden };
}
const rot13 = s => s.replace(/[a-z]/gi, c => String.fromCharCode((c <= 'Z' ? 90 : 122) >= (c = c.charCodeAt(0) + 13) ? c : c - 26));
/** Runs that read as text once decoded from base64 or hex ("SWdub3Jl…"): what they say is checked too. */
function decoded(t) {
  const out = [];
  for (const run of t.match(/[A-Za-z0-9+/_-]{16,}={0,2}/g) || []) {
    for (const enc of /^[0-9a-f]+$/i.test(run) && run.length % 2 === 0 ? ['hex', 'base64'] : ['base64']) {
      const x = Buffer.from(enc === 'base64' ? run.replace(/-/g, '+').replace(/_/g, '/') : run, enc).toString('utf8');
      if (x.length >= 8 && /^[\x20-\x7e\s]+$/.test(x) && /[a-z]{3,}\s+[a-z]{2,}/i.test(x)) out.push(x);
    }
  }
  return out;
}
/** Something that looks like a key or token: a run of mixed letters and digits, written whole or in pieces. */
function looksRandom(t) {
  for (const w of t.match(/[A-Za-z0-9+/=_-]{24,}/g) || []) {
    const digits = (w.match(/\d/g) || []).length, up = (w.match(/[A-Z]/g) || []).length, low = (w.match(/[a-z]/g) || []).length;
    if (/^[0-9a-f]{32,}$/i.test(w) && digits >= 4) return true;                            // hex
    if (digits >= 2 && up >= 2 && low >= 2) return true;                                     // base64 / base64url
  }
  // in pieces: four or more odd words in a row ("MC4C AQAw BQYD K2Vw"), at least one with a digit and one in lower case
  const words = t.split(/\s+/);
  let run = [];
  const odd = w => w.length >= 3 && /^[A-Za-z0-9+/=_-]+$/.test(w) && ((/\d/.test(w) && /[A-Za-z]/.test(w)) || /^.+[A-Z]/.test(w) || /[+/=_]/.test(w));
  for (const w of [...words, '']) {
    if (odd(w)) { run.push(w); continue; }
    if (run.length >= 4 && run.some(x => /\d/.test(x)) && run.some(x => /[a-z]/.test(x))) return true;
    run = [];
  }
  // in pieces with words or punctuation between them: four or more key-like pieces (letters and digits mixed, 6+ long) adding
  // up to 28 characters or more anywhere in the text — everyday words with numbers ("R2D2", "MP3", "COVID19") stay well short
  const pieces = words.map(w => w.replace(/^[^A-Za-z0-9+/=_-]+|[^A-Za-z0-9+/=_-]+$/g, ''))
    .filter(w => w.length >= 6 && /^[A-Za-z0-9+/=_-]+$/.test(w) && ((/\d/.test(w) && /[A-Za-z]/.test(w) && (/[a-z]/.test(w) && /[A-Z]/.test(w) || /[+/=_]/.test(w) || (w.match(/\d/g) || []).length >= 2))
      || ((w.slice(1).match(/[A-Z]/g) || []).length >= 3 && /[a-z]/.test(w))));   // (or mixed case with capitals inside: "BCIEIGxt", not "McDonald")
  if (pieces.length >= 4 && pieces.reduce((n, w) => n + w.length, 0) >= 28) return true;
  return false;
}

/** Why a text fails one kind of check, or null. kinds: secret, contact, link, manipulation, character, format. */
function why(v, kind) {
  switch (kind) {
    case 'secret': return SECRET.some(re => re.test(v.t) || re.test(v.f)) || looksRandom(v.t) ? 'secret' : null;
    case 'contact': return EMAIL.test(v.f) || EMAIL.test(v.d) || EMAIL.test(v.w) || HANDLE.test(v.f) || phoneIn(v.f) || OFF_WORLD.test(v.f) || OFF_WORLD.test(v.d) ? 'contact' : null;
    case 'link': return [v.f, v.d, v.w, v.l].some(s => LINK.test(s) || LINK_HIDDEN.test(s)) ? 'link' : null;
    case 'manipulation': return TAGS.test(v.t) || [v.f, v.d, v.j, v.l, v.lf, ...v.hidden].some(s => MANIPULATION.some(re => re.test(s))) ? 'manipulation' : null;
    case 'character': return CHARACTER.test(v.f) ? 'character' : null;
    case 'format': return FORMAT.test(v.t) ? 'format' : null;
    default: return null;
  }
}
const ALL = ['secret', 'contact', 'link', 'manipulation', 'character', 'format'];
const clean = raw => String(raw ?? '').replace(/[\u0000-\u001f\u007f\u200b-\u200f\u2028-\u202e\u2066-\u2069]/g, ' ').replace(/\s+/g, ' ').trim();

/** A text checked for some kinds: { ok, text } | { ok: false, reason }. max: the longest it may be (null: no limit). */
export function checkText(raw, { max = null, kinds = ALL } = {}) {
  let t = clean(raw);
  t = t.replace(/^["'“”‘’]+|["'“”‘’]+$/g, '').trim();
  if (!t) return { ok: false, reason: 'empty' };
  if (max && t.length > max) return { ok: false, reason: 'long' };
  const v = views(t);
  for (const k of kinds) { const r = why(v, k); if (r) return { ok: false, reason: r }; }
  return { ok: true, text: t };
}
/** A line as it may be said, or why not: { ok, text } | { ok: false, reason: 'empty'|'long'|'secret'|'contact'|'link'|'manipulation'|'character'|'format' }. */
export function localCheck(raw, maxLine = MAX_LINE) { return checkText(raw, { max: maxLine }); }
/** What a visitor writes to an outside AI: no links, contact details or words aimed at an AI (asking it things is fine). */
export const inboundCheck = raw => checkText(raw, { kinds: ['contact', 'link', 'manipulation'] });
/** What an outside AI answers a visitor (or shows while it works): nothing secret, no contact details or links. */
export const privateCheck = raw => checkText(raw, { kinds: ['secret', 'contact', 'link'] });
/** A name as an outside AI reads it: the name, or `fallback` when it carries a link, contact details or words aimed at an AI. */
export function aiName(name, fallback = 'Someone') {
  const t = clean(name);
  if (!t) return fallback;
  return checkText(t, { kinds: ['secret', 'contact', 'link', 'manipulation'] }).ok ? t : fallback;
}
/** A name someone gives (an account, an agent): null, or why it can't be (links, contact details, codes, words aimed at an AI). */
export function nameProblem(name) {
  const t = clean(name);
  if (!t) return null;
  const c = checkText(t, { kinds: ['secret', 'contact', 'link', 'manipulation'] });
  return c.ok ? null : c.reason;
}
export const NAME_REFUSED = 'A name can\'t hold links, contact details, codes or words aimed at an AI';
/** Why a text was refused, in a few words (for the AI that wrote it, a visitor, the owner). */
export const REFUSED = {
  secret: 'it looks like a key, token, code or password: those are never passed on',
  contact: 'contact details and other apps are not passed on',
  link: 'links and website names are not passed on',
  manipulation: 'it reads like instructions aimed at an AI, or asks for private things',
  character: 'it breaks character',
  format: 'it is not plain words',
  long: 'it is too long',
  empty: 'there is nothing to say',
};

const q = (s, n = 200) => `«${String(s ?? '').replace(/[\u0000-\u001f«»]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n)}»`;

/** One line to say: c = { name, role, personality, likes, now, where, doing }, s = { kind: 'greet'|'meet'|'reply', to: { name, how }, heard }. */
export function speechText(c, s) {
  const who = `${q(s.to?.name || 'Someone', 40)} (${s.to?.how || 'someone I don\'t know'})`;
  const situation = s.kind === 'greet' ? `${who} walks up to me and says hello.`
    : s.kind === 'reply' ? `${who} just said to me: ${q(s.heard, MAX_LINE)}`
      : `I've just started chatting with ${who}.`;
  return [
    `WHO I AM: ${q(c.name, 40)}${c.role ? `, ${q(c.role, 60)}` : ''}${c.personality?.length ? `; I am ${c.personality.join(', ')}` : ''}.${c.likes?.length ? ` I like ${c.likes.slice(0, 3).map(x => q(x, 40)).join(', ')}.` : ''}`,
    `NOW: ${c.now.weekday} ${c.now.clock}, ${c.where}.${c.doing ? ` I am ${q(c.doing, 80)}.` : ''}`,
    situation,
    '',
    `TASK: Say one short thing out loud (under 100 characters), in my own voice — natural, friendly${s.kind === 'reply' ? ', answering them' : ''}. Everyone around me hears it: nothing about money, my owner or anything private; no links, names of websites or contact details.`,
    'JSON: {"say":"..."}',
  ].join('\n');
}
