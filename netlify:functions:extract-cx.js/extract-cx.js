// netlify/functions/extract-cx.js
//
// Proxy server-side: guarda la API key real como variable de entorno en Netlify
// (Site settings > Environment variables > ANTHROPIC_API_KEY) y nunca la expone
// al navegador. El HTML llama a /.netlify/functions/extract-cx (mismo dominio,
// sin problema de CORS) en vez de llamar a api.anthropic.com directamente.

const SYSTEM_PROMPT = `Eres un asistente que convierte mensajes informales de WhatsApp de una secretaria médica en datos estructurados para un formato de programación de cirugía ambulatoria (otorrinolaringología, Dr. Alejandro Uribe Escobar).

Devuelve SOLO un objeto JSON válido, sin texto adicional, sin markdown, con estas claves exactas:
{
  "fechaCirugia": "string en formato 'DD DE MES' en mayúsculas, ej: '01 DE JULIO'",
  "horaCirugia": "string HH:MM en formato 24h, hora de INICIO de la cirugía",
  "duracion": "string HH:MM, duración total de la cirugía (diferencia entre hora inicio y hora fin si se dan ambas)",
  "nombrePaciente": "nombre completo del paciente, Title Case",
  "identificacion": "número de identificación, solo dígitos",
  "telefono": "teléfono si se menciona, si no, cadena vacía",
  "entidad": "EPS/aseguradora en MAYÚSCULAS",
  "confirmadoCon": "a quién se le confirmó la cita; si no se menciona, usa 'PACIENTE'",
  "cirujanos": "si se menciona un cirujano distinto al Dr. Alejandro Uribe Escobar, escríbelo; si no se menciona ninguno, usa 'ALEJANDRO URIBE ESCOBAR'",
  "anestesia": "'Local' o 'General' según lo que diga el mensaje",
  "tipoCirugiaSugerido": "'Funcional' o 'Estetica' — tu MEJOR INFERENCIA según los procedimientos descritos (turbinoplastia, septoplastia, resección de tumor, sinusitis = Funcional; rinoplastia estética, lipoescultura, otoplastia estética = Estetica). Esto es solo una sugerencia que el médico debe confirmar.",
  "procedimientos": ["lista de hasta 5 procedimientos individuales en MAYÚSCULAS, cada uno corto y claro, separando los procedimientos que vengan unidos por '+' o comas"],
  "otrosServicios": "equipos/insumos mencionados (torre de video, microdebridador, etc.), tal cual aparecen"
}

Si un dato no aparece en el mensaje, usa cadena vacía "" (excepto cirujanos y confirmadoCon que tienen default). No inventes datos que no estén en el mensaje.`;

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  let message;
  try {
    const body = JSON.parse(event.body || '{}');
    message = (body.message || '').trim();
  } catch (e) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Body inválido' }) };
  }

  if (!message) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Falta el mensaje a procesar' }) };
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return { statusCode: 500, body: JSON.stringify({ error: 'ANTHROPIC_API_KEY no está configurada en Netlify' }) };
  }

  try {
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-5',
        max_tokens: 1000,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: message }]
      })
    });

    const data = await resp.json();

    if (!resp.ok) {
      return { statusCode: resp.status, body: JSON.stringify({ error: data?.error?.message || 'Error llamando a Anthropic' }) };
    }

    const textBlock = (data.content || []).find(b => b.type === 'text');
    if (!textBlock) {
      return { statusCode: 502, body: JSON.stringify({ error: 'Respuesta sin texto del modelo' }) };
    }

    const clean = textBlock.text.trim().replace(/^```json\s*|^```\s*|```$/g, '');
    const parsed = JSON.parse(clean);

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(parsed)
    };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: 'Error interno: ' + err.message }) };
  }
};
