'use strict';
const http=require('node:http');
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {promisify}=require('node:util');
const {Pool}=require('pg');
const scrypt=promisify(crypto.scrypt);
const ROOT=__dirname;
const DATA=path.join(ROOT,'data');
const USERS_FILE=path.join(DATA,'users.json');
const ORDERS_FILE=path.join(DATA,'orders.json');
const HOST=process.env.KARA_HOST||(process.env.RENDER?'0.0.0.0':'127.0.0.1');
const PORT=Number(process.env.PORT||process.env.KARA_PORT||3000);
const SESSION_MS=12*60*60*1000;
const sessions=new Map();
const limits=new Map();
const pool=process.env.DATABASE_URL?new Pool({connectionString:process.env.DATABASE_URL,max:5,idleTimeoutMillis:30000,connectionTimeoutMillis:10000}):null;
const staticFiles=new Map([
  ['/index.html','index.html'],['/arsenal.html','arsenal.html'],['/membri.html','membri.html'],['/comenzi.html','comenzi.html'],['/auth.js','auth.js']
]);
fs.mkdirSync(DATA,{recursive:true});
function readJson(file,fallback){try{return JSON.parse(fs.readFileSync(file,'utf8'))}catch{return fallback}}
function writeJson(file,data){const tmp=file+'.tmp';fs.writeFileSync(tmp,JSON.stringify(data,null,2),{encoding:'utf8',mode:0o600});fs.renameSync(tmp,file)}
async function initDatabase(){if(!pool){if(process.env.NODE_ENV==='production')throw new Error('DATABASE_URL lipsește. Configurează conexiunea Neon înainte de pornire.');return}await pool.query(`CREATE TABLE IF NOT EXISTS kara_users (id text PRIMARY KEY, username text NOT NULL UNIQUE, display_name text NOT NULL, password_hash text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()); CREATE TABLE IF NOT EXISTS kara_orders (id text PRIMARY KEY, owner_id text NOT NULL REFERENCES kara_users(id) ON DELETE CASCADE, data jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now()); CREATE INDEX IF NOT EXISTS kara_orders_owner_created_idx ON kara_orders(owner_id, created_at DESC);`)}
function sendJson(res,status,obj,extra={}){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff',...extra});res.end(JSON.stringify(obj))}
function commonHeaders(res){res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('X-Frame-Options','DENY');res.setHeader('Referrer-Policy','strict-origin-when-cross-origin');res.setHeader('Permissions-Policy','camera=(), microphone=(), geolocation=()');res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'");res.setHeader('Cache-Control','no-store')}
function readBody(req){return new Promise((resolve,reject)=>{let data='';req.on('data',chunk=>{data+=chunk;if(data.length>16384){reject(new Error('Cererea este prea mare.'));req.destroy()}});req.on('end',()=>{try{resolve(JSON.parse(data||'{}'))}catch{reject(new Error('Date invalide.'))}});req.on('error',reject)})}
function cookies(req){const out={};for(const item of (req.headers.cookie||'').split(';')){const i=item.indexOf('=');if(i>0){try{out[item.slice(0,i).trim()]=decodeURIComponent(item.slice(i+1).trim())}catch{}}}return out}
async function findUserById(id){if(pool){const {rows}=await pool.query('SELECT id, username, display_name AS "displayName" FROM kara_users WHERE id=$1',[id]);return rows[0]||null}return readJson(USERS_FILE,[]).find(u=>u.id===id)||null}
async function currentUser(req){const token=cookies(req).kara_hilal_session;const entry=token&&sessions.get(token);if(!entry)return null;if(entry.expires<Date.now()){sessions.delete(token);return null}entry.expires=Date.now()+SESSION_MS;return findUserById(entry.userId)}
function setSession(req,res,user){const token=crypto.randomBytes(32).toString('hex');sessions.set(token,{userId:user.id,expires:Date.now()+SESSION_MS});const secure=(req.socket.encrypted||req.headers['x-forwarded-proto']==='https'||process.env.KARA_HTTPS==='1')?'; Secure':'';res.setHeader('Set-Cookie',`kara_hilal_session=${token}; HttpOnly; Path=/; SameSite=Strict; Max-Age=${SESSION_MS/1000}${secure}`)}
function rateLimit(req,key){const ip=req.socket.remoteAddress||'unknown';const k=ip+':'+key;const now=Date.now();let x=limits.get(k);if(!x||x.until<now)x={count:0,until:now+15*60*1000};x.count++;limits.set(k,x);return x.count<=30}
async function passwordRecord(password){const salt=crypto.randomBytes(16);const hash=await scrypt(password,salt,64);return `${salt.toString('hex')}:${Buffer.from(hash).toString('hex')}`}
async function passwordMatches(password,record){try{const [saltHex,hashHex]=record.split(':');const expected=Buffer.from(hashHex,'hex');const actual=Buffer.from(await scrypt(password,Buffer.from(saltHex,'hex'),expected.length));return expected.length===actual.length&&crypto.timingSafeEqual(expected,actual)}catch{return false}}
function serveFile(res,file){const ext=path.extname(file);const type=ext==='.html'?'text/html; charset=utf-8':ext==='.js'?'text/javascript; charset=utf-8':'application/octet-stream';try{const body=fs.readFileSync(path.join(ROOT,file));res.writeHead(200,{'Content-Type':type,'Content-Length':body.length,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(body)}catch{res.writeHead(404,{'Content-Type':'text/plain; charset=utf-8'});res.end('Pagina nu a fost găsită.')}}
function safeNext(value){const allowed=['/index.html','/arsenal.html','/membri.html','/comenzi.html'];try{const u=new URL(value||'/index.html','http://local');return allowed.includes(u.pathname)?u.pathname+u.hash:'/index.html'}catch{return '/index.html'}}
async function createUser(username,displayName,passwordHash){const user={id:crypto.randomUUID(),username,displayName,passwordHash,createdAt:new Date().toISOString()};if(pool){try{await pool.query('INSERT INTO kara_users(id,username,display_name,password_hash) VALUES($1,$2,$3,$4)',[user.id,username,displayName,passwordHash]);return user}catch(err){if(err.code==='23505')return null;throw err}}const users=readJson(USERS_FILE,[]);if(users.some(u=>u.username===username))return null;users.push(user);writeJson(USERS_FILE,users);return user}
async function findUserByUsername(username){if(pool){const {rows}=await pool.query('SELECT id,username,display_name AS "displayName",password_hash AS "passwordHash" FROM kara_users WHERE username=$1',[username]);return rows[0]||null}return readJson(USERS_FILE,[]).find(u=>u.username===username)||null}
async function saveOrder(user,body){const order={...body,id:crypto.randomUUID(),created:new Date().toISOString(),owner:user.id};if(pool){await pool.query('INSERT INTO kara_orders(id,owner_id,data,created_at) VALUES($1,$2,$3::jsonb,$4)',[order.id,user.id,JSON.stringify(order),order.created]);return order}const store=readJson(ORDERS_FILE,{});store[user.id]=Array.isArray(store[user.id])?store[user.id]:[];store[user.id].unshift(order);writeJson(ORDERS_FILE,store);return order}
async function listOrders(user){if(pool){const {rows}=await pool.query('SELECT data FROM kara_orders WHERE owner_id=$1 ORDER BY created_at DESC',[user.id]);return rows.map(r=>r.data)}const store=readJson(ORDERS_FILE,{});return Array.isArray(store[user.id])?store[user.id]:[]}
async function handle(req,res){commonHeaders(res);const url=new URL(req.url,'http://localhost');const route=url.pathname;
  if(req.method==='GET'&&route==='/healthz')return sendJson(res,200,{ok:true});
  if(req.method==='GET'&&(route==='/login'||route==='/login.html'))return serveFile(res,'login.html');
  if(route==='/api/signup'&&req.method==='POST'){
    if(!rateLimit(req,'auth'))return sendJson(res,429,{error:'Prea multe încercări. Încearcă din nou peste 15 minute.'});
    let body;try{body=await readBody(req)}catch(e){return sendJson(res,400,{error:e.message})}
    const username=String(body.username||'').trim().toLowerCase();const displayName=String(body.displayName||'').trim();const password=String(body.password||'');
    if(!/^[a-z0-9_.-]{3,24}$/.test(username))return sendJson(res,400,{error:'Numele de utilizator trebuie să aibă 3–24 caractere: litere, cifre, punct, _ sau -.'});
    if(displayName.length<2||displayName.length>40||/[\u0000-\u001f]/.test(displayName))return sendJson(res,400,{error:'Introdu un nume în joc de 2–40 caractere.'});
    if(password.length<10||password.length>128)return sendJson(res,400,{error:'Parola trebuie să aibă între 10 și 128 de caractere.'});
    const passwordHash=await passwordRecord(password);const user=await createUser(username,displayName,passwordHash);if(!user)return sendJson(res,409,{error:'Acest nume de utilizator este deja folosit.'});setSession(req,res,user);return sendJson(res,201,{ok:true,user:{username,displayName},next:safeNext(body.next)});
  }
  if(route==='/api/login'&&req.method==='POST'){
    if(!rateLimit(req,'auth'))return sendJson(res,429,{error:'Prea multe încercări. Încearcă din nou peste 15 minute.'});
    let body;try{body=await readBody(req)}catch(e){return sendJson(res,400,{error:e.message})}
    const username=String(body.username||'').trim().toLowerCase();const password=String(body.password||'');const user=await findUserByUsername(username);
    if(!user||!await passwordMatches(password,user.passwordHash))return sendJson(res,401,{error:'Date de conectare incorecte.'});
    setSession(req,res,user);return sendJson(res,200,{ok:true,user:{username:user.username,displayName:user.displayName},next:safeNext(body.next)});
  }
  if(route==='/api/me'&&req.method==='GET'){const user=await currentUser(req);return user?sendJson(res,200,{user:{username:user.username,displayName:user.displayName}}):sendJson(res,401,{error:'Nu ești conectat.'})}
  if(route==='/api/logout'&&req.method==='POST'){const token=cookies(req).kara_hilal_session;if(token)sessions.delete(token);res.setHeader('Set-Cookie','kara_hilal_session=; HttpOnly; Path=/; SameSite=Strict; Max-Age=0');return sendJson(res,200,{ok:true})}
  if(route==='/api/orders'&&req.method==='GET'){const user=await currentUser(req);if(!user)return sendJson(res,401,{error:'Conectează-te pentru a vedea comenzile.'});return sendJson(res,200,await listOrders(user))}
  if(route==='/api/orders'&&req.method==='POST'){const user=await currentUser(req);if(!user)return sendJson(res,401,{error:'Conectează-te pentru a salva o comandă.'});let body;try{body=await readBody(req)}catch(e){return sendJson(res,400,{error:e.message})}if(!body||!Array.isArray(body.items)||body.items.length<1||body.items.length>50||typeof body.name!=='string'||body.name.length>50||!Number.isFinite(Number(body.total))||Number(body.total)<0)return sendJson(res,400,{error:'Datele comenzii sunt invalide.'});const order=await saveOrder(user,body);return sendJson(res,201,{ok:true,id:order.id})}
  if(route==='/'||route==='/index.html'||staticFiles.has(route)){
    const user=await currentUser(req);if(!user&&route!=='/auth.js'){res.writeHead(302,{Location:'/login.html?next='+encodeURIComponent(route==='/'?'/index.html':route)});return res.end()}
    if(route==='/')return serveFile(res,'index.html');return serveFile(res,staticFiles.get(route)||'index.html');
  }
  res.writeHead(404,{'Content-Type':'text/plain; charset=utf-8'});res.end('Pagina nu a fost găsită.');
}
const server=http.createServer((req,res)=>{handle(req,res).catch(err=>{console.error('Eroare internă:',err.message);if(!res.headersSent)sendJson(res,500,{error:'A apărut o eroare. Încearcă din nou.'});else res.destroy()})});
initDatabase().then(()=>server.listen(PORT,HOST,()=>console.log(`Kara Hilal rulează la http://${HOST}:${PORT}`))).catch(err=>{console.error('Pornirea aplicației a eșuat:',err.message);process.exit(1)});
