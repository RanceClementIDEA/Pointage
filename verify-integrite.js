/* Éprouve le contrôle d'intégrité : on force le bac à sable à écrire
   dans la VRAIE mémoire, et on vérifie que la page le détecte. */
const fs = require("fs"), vm = require("vm"), path = require("path");
const script = fs.readFileSync("tests.html", "utf8").match(/<script>([\s\S]*)<\/script>/)[1];
const sabotage = process.argv.includes("--sabotage");

const registre = new Map();
function elem(tag, id) {
  const el = { tagName:(tag||"div").toUpperCase(), id:id||"", textContent:"", innerHTML:"", value:"",
    disabled:false, children:[], style:{}, dataset:{}, _cls:new Set(),
    classList:{ add:c=>el._cls.add(c), remove:c=>el._cls.delete(c), contains:c=>el._cls.has(c),
      toggle:(c,f)=>(f===undefined?(el._cls.has(c)?el._cls.delete(c):el._cls.add(c)):(f?el._cls.add(c):el._cls.delete(c))) },
    get className(){return [...el._cls].join(" ");}, set className(v){el._cls=new Set(String(v).split(/\s+/).filter(Boolean));},
    appendChild(c){el.children.push(c);return c;}, insertBefore(c){el.children.unshift(c);return c;},
    get firstChild(){return el.children[0]||null;},
    addEventListener(){}, setAttribute(){}, querySelectorAll:()=>[], querySelector:()=>null, focus(){}, remove(){} };
  return el;
}
const memoire = { kpiUser:"clement", kpiManualEntries:'[{"id":"a","title":"A","freq":"Mensuelle"}]',
                  kpiSites:'[{"key":"logistiport","name":"Logistiport"}]', kpiPurgedIds:'[]' };
const sandbox = {
  console,
  document:{ getElementById(id){ if(!registre.has(id)) registre.set(id, elem("div", id)); return registre.get(id); },
             createElement:t=>elem(t), querySelectorAll:()=>[], addEventListener(){}, head:elem("head") },
  localStorage:{ getItem:k=>(memoire[k]===undefined?null:memoire[k]), setItem:(k,v)=>{memoire[k]=String(v);},
    removeItem:k=>{delete memoire[k];}, key:i=>Object.keys(memoire)[i],
    get length(){return Object.keys(memoire).length;} },
  location:{ href:"https://test/tests.html", origin:"https://test", pathname:"/tests.html", protocol:"https:", reload(){} },
  performance:{ now:()=>Date.now() },
  navigator:{ userAgent:"Vérif", onLine:true, clipboard:{writeText:async()=>{}}, serviceWorker:{register:async()=>{}} },
  setTimeout, clearTimeout, setInterval,
  addEventListener(){}, removeEventListener(){}, matchMedia:()=>({matches:false,addListener(){},addEventListener(){}}),
  fetch: async (url) => {
    const f = String(url).split("?")[0], p = path.join(process.cwd(), f);
    if (!fs.existsSync(p)) return { ok:false, status:404, text:async()=>"", arrayBuffer:async()=>new ArrayBuffer(0) };
    if (/\.pptx$/.test(f)) {
      const b = fs.readFileSync(p);
      return { ok:true, status:200, text:async()=>"",
               arrayBuffer:async()=>b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) };
    }
    let src = fs.readFileSync(p, "utf8");
    // SABOTAGE : on fait écrire app.js dans la vraie mémoire au chargement
    if (sabotage && f === "app.js") src += '\n;try{ globalThis.localStorage.setItem("kpiManualEntries","[]"); }catch(e){}\n';
    return { ok:true, status:200, text:async()=>src, arrayBuffer:async()=>new ArrayBuffer(0) };
  }
};
sandbox.window=sandbox; sandbox.globalThis=sandbox; sandbox.self=sandbox;
/* Primitives du navigateur absentes d'un contexte vm : la fabrique de
   PowerPoint (js/zip.js) en a besoin. */
sandbox.TextEncoder = TextEncoder; sandbox.TextDecoder = TextDecoder;
sandbox.Blob = Blob; sandbox.DecompressionStream = DecompressionStream;
vm.createContext(sandbox);
vm.runInContext(script, sandbox, { filename:"tests.html" });

setTimeout(() => {
  const etat = registre.get("etatTxt");
  console.log("État :", etat ? etat.textContent : "(absent)");
  const badge = registre.get("bIntegrite");
  console.log("Badge affiché :", badge.textContent);
  const groupes = registre.get("sortie").children;
  const bloc = groupes.find(g => (g.children[0]?.innerHTML || "").includes("Intégrité"));
  if (!bloc) { console.log("✗ section d'intégrité absente"); process.exit(1); }
  const lignes = (bloc.children[1]?.children || []);
  lignes.forEach(l => {
    const ok = l.innerHTML.includes("puce ok");
    const nom = (l.innerHTML.match(/class="nom">([^<]+)/) || [])[1] || "?";
    if (!ok) console.log("  ✗ " + nom.trim());
  });
  const intacte = badge.textContent.includes("intactes");
  if (sabotage) {
    console.log(intacte ? "\n✗ ÉCHEC : la corruption n'a pas été détectée" : "\n✓ La corruption est bien détectée");
    process.exit(intacte ? 1 : 0);
  } else {
    console.log(intacte ? "\n✓ Données intactes, correctement rapporté" : "\n✗ fausse alerte");
    process.exit(intacte ? 0 : 1);
  }
}, 25000);
