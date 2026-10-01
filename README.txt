KARA HILAL — publicare online cu Neon și Render

De ce nu merge autentificarea din fișierul deschis direct
Pagina login.html doar afișează formularul. Crearea contului și conectarea trimit datele la serverul site-ului; fișierele deschise cu file:// nu au server/API. Am reparat și eroarea JavaScript care împiedica butoanele paginii să răspundă.

Pregătire pentru publicare
1. Creează un proiect GitHub nou și încarcă în el toate fișierele din acest folder. Fișierul render.yaml trebuie să fie la rădăcina proiectului GitHub.
2. Creează un proiect PostgreSQL în Neon.
3. În Neon, apasă Connect și copiază connection string-ul pooled pentru baza de date. Păstrează-l secret.
4. În Render, alege New > Blueprint și conectează proiectul GitHub încărcat la pasul 1.
5. La configurarea Blueprint, adaugă string-ul Neon ca valoarea secretă pentru DATABASE_URL, apoi pornește deploy-ul.
6. Render instalează aplicația, pornește serverul și îi dă un link public HTTPS. Deschide linkul Render; membrii își pot crea cont și intra de pe dispozitivele lor.

În repo-ul GitHub trebuie să se afle fișierele acestui folder direct la rădăcină, inclusiv render.yaml, package.json și server.js.

Conturile și comenzile se salvează în Neon. Schema tabelelor este creată automat la prima pornire. Parolele sunt stocate ca hash-uri. Lista „Membri” rămâne momentan în browserul fiecărui dispozitiv.

Setări locale opționale
Pentru pornire pe calculator, instalează Node.js 20+, deschide terminalul în acest folder, rulează `npm install` și apoi `npm start`. Fără DATABASE_URL aplicația rulează local cu stocare JSON; versiunea de producție cere baza Neon configurată.

Nu pune niciodată parola bazei de date în fișierele site-ului sau într-un repo public. Introdu DATABASE_URL doar în setările secrete Render.
