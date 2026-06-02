import { google } from 'googleapis';
import type { VercelRequest, VercelResponse } from '@vercel/node';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    const oauth2Client = new google.auth.OAuth2(
      process.env.GMAIL_CLIENT_ID as string,
      process.env.GMAIL_CLIENT_SECRET as string
    );

    oauth2Client.setCredentials({
      refresh_token: process.env.GMAIL_REFRESH_TOKEN as string
    });

    const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

    // 1. Limites expandidos e mais palavras-chave para varrer melhor o dia
    const query = 'newer_than:1d (vaga OR "processo seletivo" OR candidatura OR entrevista OR infelizmente OR "não daremos andamento" OR "agradecemos" OR "outros candidatos")';
    
    const listResponse = await gmail.users.messages.list({
      userId: 'me',
      q: query,
      maxResults: 50 
    });

    const messages = listResponse.data.messages || [];

    if (messages.length === 0) {
      await enviarTelegram('🔍 *Monitor de Vagas:* Nenhum e-mail de processos seletivos foi encontrado nas últimas 24 horas.');
      return res.status(200).json({ status: 'success', data: 'Nenhum e-mail encontrado.' });
    }

    // 2. Extração do corpo REAL do e-mail com decodificação em Base64
    const listaResumos: string[] = [];
    for (const msg of messages) {
      const details = await gmail.users.messages.get({
        userId: 'me',
        id: msg.id!,
        format: 'full' 
      });
      
      const payload = details.data.payload;
      let corpoTexto = '';

      if (payload?.parts) {
        const part = payload.parts.find(p => p.mimeType === 'text/plain') || payload.parts[0];
        if (part?.body?.data) {
          corpoTexto = Buffer.from(part.body.data, 'base64').toString('utf-8');
        }
      } else if (payload?.body?.data) {
        corpoTexto = Buffer.from(payload.body.data, 'base64').toString('utf-8');
      }

      // Pega os 1000 primeiros caracteres para a IA ler a recusa que fica no meio do texto
      const textoFinal = corpoTexto ? corpoTexto.substring(0, 1000) : details.data.snippet;
      
      if (textoFinal) {
        // Limpa espaços extras para economizar o consumo de tokens na IA
        listaResumos.push(`- E-mail: ${textoFinal.replace(/\s+/g, ' ')}`);
      }
    }

    const relatorioIA = await analisarComGemini(listaResumos.join('\n'));

    await enviarTelegram(relatorioIA);

    return res.status(200).json({ status: 'success', totalProcessado: messages.length });
  } catch (error: any) {
    console.error('Erro durante a execução do monitor:', error);
    await enviarTelegram(`❌ *Erro no Monitor de Vagas:* ${error.message}`);
    return res.status(500).json({ status: 'error', message: error.message });
  }
}

async function analisarComGemini(textoEmails: string): Promise<string> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${process.env.GEMINI_API_KEY}`;
  
  // 3. Prompt aprimorado focando na estrutura e na "malícia" para identificar recusas
  const prompt = `
    Atue como um assistente de triagem de e-mails de recrutamento. Analise a seguinte lista de e-mails recebidos.
    O seu objetivo é gerar um resumo diário estruturado para o Telegram.
    
    Classifique as mensagens nestas categorias, ignorando completamente lixo, publicidade ou alertas de vagas genéricas:
    
    1. 🎉 **Avanços / Entrevistas:** (Convites, testes práticos, próximos passos).
    2. ❌ **Rejeições:** (Recusas, processos encerrados, "agradecemos o interesse").
    3. ℹ️ **Atualizações:** (Apenas candidaturas recebidas ou atualizações de status).

    Para CADA e-mail relevante encontrado, escreva no formato:
    - **[Nome da Empresa]** | [Nome da Vaga (se houver)]
      ↳ *Resumo do que aconteceu em uma linha.*

    Se não houver e-mails para uma categoria, não a inclua. Formate usando Markdown do Telegram.

    Regra de Ouro (Cuidado com o "Feedback Sanduíche" de RH): 
    Muitos e-mails de recusa começam com um tom super positivo ("Ficamos impressionados com seu perfil", "Obrigado por participar"). Leia todo o texto. Se contiver palavras como "infelizmente", "decidimos seguir com outros candidatos", "não daremos andamento", classifique IMEDIATAMENTE como ❌ Rejeição, ignorando os elogios iniciais.
    
    E-mails a analisar:
    ${textoEmails}
  `;

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }]
    })
  });

  const json: any = await response.json();
  return json.candidates?.[0]?.content?.parts?.[0]?.text || 'Não foi possível gerar o resumo com a IA.';
}

async function enviarTelegram(mensagem: string): Promise<void> {
  const token = process.env.TELEGRAM_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  const url = `https://api.telegram.org/bot${token}/sendMessage`;

  await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text: mensagem,
      parse_mode: 'Markdown'
    })
  });
}