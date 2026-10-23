// Conteúdo do evento. Horários, salas e palestrantes são PLACEHOLDERS: confirmar com a OFG.
export const EVENT = {
  name: 'OFG Recife 2026',
  tagline: 'Rotas e oportunidades',
  venue: {
    name: 'Hub Plural Espinheiro',
    address: 'Av. Gov. Agamenon Magalhães, 2939 - Espinheiro, Recife - PE',
    room: 'Espinheiro · Recife/PE',
    mapsQuery: 'Hub Plural Espinheiro, Av. Gov. Agamenon Magalhães, 2939 - Espinheiro, Recife - PE',
  },
  days: [
    { id: 'd1', date: '2026-11-03', title: 'Saúde Mental', subtitle: 'Apresentação + almoço' },
    { id: 'd2', date: '2026-11-04', title: '33 Anos OFG', subtitle: 'Apresentação + jantar' },
    { id: 'd3', date: '2026-11-05', title: 'Internacionalização', subtitle: 'com a Porto Digital · business drink às 16h' },
  ],
  rooms: ['Auditório', 'Área de convívio'],
  theme: { title: 'Oporto Forte Group · 33 Anos', subtitle: 'Conectando lideranças executivas, capital estratégico e governança transatlântica.', central: 'Rotas & Oportunidades · 2027: missões empresariais' },
};

// Horários em hora de Recife (UTC-3).
export const SESSIONS = [
  { id: 's1', tag: 'Receção', day: 'd1', start: '09:00', end: '09:30', room: 'Auditório', title: 'Credenciamento e boas-vindas', speaker: 'Equipa OFG', desc: 'Check-in via QR code e café de boas-vindas.' },
  { id: 's2', tag: 'Painel', day: 'd1', start: '09:30', end: '10:30', room: 'Auditório', title: 'Saúde mental, burnout e segurança psicológica 2027', speaker: 'A confirmar', desc: 'Panorama e tendências para a gestão de pessoas em 2027.' },
  { id: 's3', tag: 'Painel', day: 'd1', start: '10:30', end: '11:30', room: 'Auditório', title: 'Experiências de empresas portuguesas e europeias na gestão de pessoas', speaker: 'A confirmar', desc: 'Casos práticos de empresas de Portugal e da Europa.' },
  { id: 's4', tag: 'Painel', day: 'd1', start: '11:30', end: '12:30', room: 'Auditório', title: 'NR-1 e prevenção de riscos psicossociais no Brasil', speaker: 'A confirmar', desc: 'O que muda com a NR-1 e como preparar a sua organização.' },
  { id: 's5', tag: 'Networking', day: 'd1', start: '12:30', end: '14:00', room: 'Área de convívio', title: 'Almoço e networking', speaker: '', desc: 'Conexões e troca de experiências entre líderes e gestores.' },
  { id: 's6', tag: 'Painel', day: 'd1', start: '14:00', end: '15:00', room: 'Auditório', title: 'Transformar desafios de gestão de pessoas em oportunidades de evolução', speaker: 'A confirmar', desc: 'Debate com participação do público (perguntas ao vivo).' },
  { id: 's7', tag: 'Institucional', day: 'd1', start: '15:00', end: '15:30', room: 'Auditório', title: 'Programa de saúde mental e Passe de Ouro', speaker: 'Equipa OFG', desc: 'Apresentação do programa e do projeto Um Saque para a Vida: 125 crianças, 125 oportunidades.' },
  { id: 's8', tag: 'Receção', day: 'd2', start: '18:00', end: '18:30', room: 'Auditório', title: 'Receção e check-in', speaker: 'Equipa OFG', desc: 'Receção dos convidados.' },
  { id: 's9', tag: 'Institucional', day: 'd2', start: '18:30', end: '19:30', room: 'Auditório', title: '33 anos de OFG: a nossa história pelos mercados', speaker: 'A confirmar', desc: 'Resumo da história da OFG com destaque para os diferentes mercados.' },
  { id: 's10', tag: 'Institucional', day: 'd2', start: '19:30', end: '20:00', room: 'Auditório', title: 'Próximos passos: 2027 e missões empresariais', speaker: 'A confirmar', desc: 'Rotas e oportunidades para a internacionalização.' },
  { id: 's11', tag: 'Networking', day: 'd2', start: '20:00', end: '22:30', room: 'Área de convívio', title: 'Jantar comemorativo', speaker: '', desc: 'Jantar dos 33 anos.' },
  { id: 's12', tag: 'Receção', day: 'd3', start: '14:00', end: '14:30', room: 'Auditório', title: 'Receção e check-in', speaker: 'Equipa OFG', desc: 'Receção dos participantes.' },
  { id: 's13', tag: 'Painel', day: 'd3', start: '14:30', end: '15:30', room: 'Auditório', title: 'Internacionalização: rotas e oportunidades', speaker: 'OFG & Porto Digital', desc: 'Evento de internacionalização em parceria com a Porto Digital.' },
  { id: 's14', tag: 'Networking', day: 'd3', start: '16:00', end: '18:00', room: 'Área de convívio', title: 'Business drink', speaker: '', desc: 'Networking de encerramento.' },
];

export const SPONSORS = [
  { name: 'Oporto Forte Group', tier: 'Organização', url: 'https://oportofortegroup.com' },
  { name: 'Porto Digital', tier: 'Parceiro institucional', url: 'https://www.portodigital.org' },
  { name: 'Um Saque para a Vida', tier: 'Causa solidária', url: '' },
];

export const FAQS = [
  { q: 'Onde é o evento?', a: 'No Hub Plural Espinheiro: Av. Gov. Agamenon Magalhães, 2939, Espinheiro, Recife - PE.' },
  { q: 'Como faço check-in?', a: 'Na receção, leia o QR code do dia com a câmara do telemóvel (abre a app e faz o check-in) ou introduza o código na aba Mais > Check-in.' },
  { q: 'Como funciona o networking?', a: 'Crie o seu perfil, procure participantes ou veja as sugestões, envie um pedido de conexão. Quando aceite, podem trocar mensagens e contactos.' },
  { q: 'O que é o Passe de Ouro?', a: 'Contribuição que se converte em tênis para crianças do projeto Um Saque para a Vida.' },
  { q: 'Como recebo avisos?', a: 'Ative as notificações quando a app pedir. Mudanças de sala e atrasos aparecem em tempo real na aba Início.' },
  { q: 'Preciso de instalar algo?', a: 'Não. É uma web app: abra o link e, se quiser, use "Adicionar ao ecrã principal".' },
];

export const INTERESTS = [
  'Saúde mental', 'Gestão de pessoas', 'NR-1', 'Internacionalização', 'Portugal', 'Europa',
  'Tecnologia', 'Inovação', 'Liderança', 'RH', 'Investimento', 'Sustentabilidade',
];

export const POINTS = { checkin: 50, favorite: 5, connect: 20, message: 2, vote: 10, question: 15, profile: 30 };
