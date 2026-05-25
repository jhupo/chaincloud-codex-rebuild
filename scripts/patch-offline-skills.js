#!/usr/bin/env node
/**
 * Keep recommended skills usable without cloning github.com/openai/skills.git.
 *
 * Upstream falls back to a network clone when the bundled recommended-skill
 * repo layout is unavailable. The ChainCloud build should not surface that
 * clone error to users in locked-down networks.
 */
const { fs, path, read, relPath, SRC_DIR, write } = require("./patch-util");

const PATCH_MARKER = "__CHAINCLOUD_OFFLINE_RECOMMENDED_SKILLS_V1__";

function patchRecommendedSkills(source) {
  if (source.includes(PATCH_MARKER)) return { source, changed: false };

  const start = source.indexOf("async function bP({");
  const end = source.indexOf("async function xP({", start);
  if (start < 0 || end <= start) return { source, changed: false };

  const replacement =
    `var ${PATCH_MARKER}=!0;` +
    `async function bP({refresh:t=!1,preferWsl:n=!1,bundledRepoRoot:r=null,appServerClient:a}){` +
    `let o=e.sn(a.hostConfig)?a.hostConfig.kind===\`remote-control\`?a.hostConfig.id:a.hostConfig.terminal_command.join(\` \`):void 0,` +
    `s=e.sn(a.hostConfig)?await a.codexHome():Ge({preferWsl:n,hostConfig:a.hostConfig}),` +
    `c=await a.platformPath(),l=c.join(s,\`vendor_imports\`),u=c.join(l,\`skills\`),` +
    `f=VP(c),p=f.map(e=>c.join(u,e)),h=c.join(l,\`skills-curated-cache.json\`),` +
    `g=o||!r?null:i.default.resolve(r),_=g?VP(i.default).map(e=>i.default.join(g,e)):null,` +
    `v=g?i.default.join(g,BP(i.default)):null,y=await RP(h,a),C=v?await LP(v,a):!1;` +
    `try{` +
    `if(C){let e=await xP({repoRoot:g??u,recommendedRoots:_??p,path:g?i.default:c,appServerClient:a}),t=Date.now();return await zP(h,{fetchedAt:t,skills:e},c,a),{skills:e,fetchedAt:t,source:\`bundled\`,repoRoot:g??null,error:null}}` +
    `if(y)return{skills:y.skills,fetchedAt:y.fetchedAt,source:\`cache\`,repoRoot:u,error:null};` +
    `let e=Date.now();return await zP(h,{fetchedAt:e,skills:[]},c,a),{skills:[],fetchedAt:e,source:\`offline\`,repoRoot:g??u,error:null}` +
    `}catch(e){let t=e instanceof Error?e.message:String(e),n=C&&g?g:u;return pP().warning(\`Failed to load bundled recommended skills\`,{safe:{},sensitive:{error:e}}),y?{skills:y.skills,fetchedAt:y.fetchedAt,source:\`cache\`,repoRoot:n,error:null}:{skills:[],fetchedAt:null,source:\`offline\`,repoRoot:n,error:null}}` +
    `}`;

  return {
    source: source.slice(0, start) + replacement + source.slice(end),
    changed: true,
  };
}

function main() {
  const args = process.argv.slice(2);
  const isCheck = args.includes("--check");
  const platform = args.find((a) => ["mac-arm64", "mac-x64", "win"].includes(a));
  const platforms = platform ? [platform] : ["mac-arm64", "mac-x64", "win"];
  const targets = platforms.flatMap((platform) => {
    const dir = path.join(SRC_DIR, platform, "_asar", ".vite", "build");
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir)
      .filter((name) => name.endsWith(".js"))
      .map((name) => ({ platform, path: path.join(dir, name) }));
  });
  let touched = 0;

  for (const target of targets) {
    const source = read(target.path);
    if (!source.includes("https://github.com/openai/skills.git") || !source.includes("async function bP({")) {
      continue;
    }
    const result = patchRecommendedSkills(source);
    if (!result.changed) {
      console.log(`[ok] ${target.platform}: ${relPath(target.path)} already patched`);
      continue;
    }
    console.log(`${isCheck ? "[?]" : "[*]"} ${target.platform}: patch recommended skills offline fallback in ${relPath(target.path)}`);
    if (!isCheck) write(target.path, result.source);
    touched++;
  }

  if (touched === 0) console.log("[ok] No recommended skills patch needed");
}

main();
