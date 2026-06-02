import { google } from 'googleapis';
import * as fs from 'fs';
import * as readline from 'readline';

const CREDENTIALS_PATH = 'credentials.json';

async function main() {
  const content = fs.readFileSync(CREDENTIALS_PATH, 'utf8');
  const credentials = JSON.parse(content);
  
  // Lê os dados do arquivo JSON
  const { client_secret, client_id, redirect_uris } = credentials.web || credentials.installed;
  
  const oAuth2Client = new google.auth.OAuth2(client_id, client_secret, redirect_uris[0]);

  // Gera a URL de autorização exigindo o acesso offline (que devolve o refresh_token)
  const authUrl = oAuth2Client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: ['https://www.googleapis.com/auth/gmail.readonly'],
  });

  console.log('1. Clique neste link para autorizar o app:', authUrl);
  console.log('\n2. Após aceitar, você será redirecionado para uma página de erro (localhost).');
  console.log('3. Olhe a URL no seu navegador e copie APENAS o código que vem depois de "?code=" (e antes do "&scope").');

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  rl.question('\nCole o código da URL aqui: ', async (code) => {
    try {
      // O código vindo da URL costuma vir com "%2F" no lugar das barras, então decodificamos
      const decodedCode = decodeURIComponent(code);
      const { tokens } = await oAuth2Client.getToken(decodedCode);
      
      console.log('\n✅ SUCESSO! Copie o seu Refresh Token abaixo:\n');
      console.log(`GMAIL_REFRESH_TOKEN="${tokens.refresh_token}"`);
      console.log('\nCole isso no seu arquivo .env e preencha a última variável!');
    } catch (error) {
      console.error('Erro ao resgatar o token:', error);
    }
    rl.close();
  });
}

main();