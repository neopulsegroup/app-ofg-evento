// Conteúdo do evento (programação oficial de 3/11/2026).
export const EVENT = {
  name: 'OFG Recife 2026',
  tagline: 'Saúde mental nas empresas',
  venue: {
    name: 'Hub Plural Espinheiro',
    address: 'Av. Gov. Agamenon Magalhães, 2939 - Espinheiro, Recife - PE, 52021-170',
    room: 'Espinheiro · Recife/PE',
    mapsQuery: 'Hub Plural Espinheiro, Av. Gov. Agamenon Magalhães, 2939 - Espinheiro, Recife - PE',
  },
  days: [
    { id: 'd1', date: '2026-11-03', title: 'Saúde Mental', subtitle: 'Entrada solidária · Instituto do Tênis' },
  ],
  rooms: ['Auditório'],
  theme: { title: 'Grande Encontro de Gestores e Líderes de RH e Gestão de Pessoas', subtitle: 'Saúde Mental nas Empresas: o que 2026 ensinou e como se preparar para 2027.', central: 'Entrada solidária: um par de tênis ou voucher para o Instituto do Tênis' },
  topics: [
    'As palavras de 2026: burnout, turnover, absenteísmo, NR-01',
    'O que as empresas que entregam resultado fazem em comum',
    'Como medir, agir e acompanhar',
    'Como a tecnologia pode ser nossa aliada e apoiar as empresas de forma mais eficaz',
    'Perspectiva 2027: o que cada empresa deve começar já',
  ],
};

// Horários em hora de Recife (UTC-3).
const PAINEL = [
  { name: 'Nubia Correia', role: 'Moderação' },
  { name: 'Patrícia Cardoso', role: 'Oporto Forte, Portugal: boas práticas das empresas europeias' },
  { name: 'Mário Melo', role: 'Especialista em riscos psicossociais: o cenário brasileiro e a NR-01' },
  { name: 'Cássia Albuquerque', role: 'Psicóloga, Recife: a realidade das empresas de Pernambuco' },
  { name: 'Silva Jonathan e Renato Menezes', role: 'Tecnologia e Inovação, Oporto Forte Group: como medir, agir e acompanhar de forma contínua, usando a tecnologia como aliada' },
];
export const SESSIONS = [
  { id: 'p1', tag: 'Receção', day: 'd1', start: '15:30', end: '16:00', room: 'Auditório', title: 'Credenciamento e entrega solidária', speaker: 'Equipe OFG', desc: 'Check-in via QR code e entrega do par de tênis ou voucher para o Instituto do Tênis.' },
  { id: 'p2', tag: 'Institucional', day: 'd1', start: '16:00', end: '16:10', room: 'Auditório', title: 'Abertura e apresentação da causa', speaker: 'Oporto Forte Group (Nadja Ferreira e Monica) e Instituto do Tênis', desc: 'Abertura do encontro e apresentação da causa solidária.' },
  { id: 'p3', tag: 'Institucional', day: 'd1', start: '16:10', end: '16:15', room: 'Auditório', title: 'Vídeo de abertura: saúde mental nas empresas em números', speaker: '', desc: 'Os números da saúde mental nas empresas.' },
  { id: 'p4', tag: 'Painel', day: 'd1', start: '16:15', end: '17:05', room: 'Auditório', title: 'Painel: o que marcou 2026 e o que esperar de 2027', speaker: 'Moderação: Nubia Correia', desc: 'Europa, Brasil e Pernambuco lado a lado, e como medir, agir e acompanhar de forma contínua com a ajuda da tecnologia.', people: PAINEL },
  { id: 'p5', tag: 'Painel', day: 'd1', start: '17:05', end: '17:15', room: 'Auditório', title: 'Perguntas da plateia', speaker: 'Painelistas', desc: 'Envie a sua pergunta na aba Ao Vivo e vote nas dos colegas.' },
  { id: 'p6', tag: 'Institucional', day: 'd1', start: '17:15', end: '17:20', room: 'Auditório', title: 'Entrega simbólica das doações e foto oficial', speaker: 'Instituto do Tênis e Oporto Forte Group', desc: 'Entrega simbólica das doações ao Instituto do Tênis e foto oficial do encontro.' },
  { id: 'p7', tag: 'Networking', day: 'd1', start: '17:20', end: '18:00', room: 'Auditório', title: 'Coffee break e encerramento', speaker: '', desc: 'Encerramento com coffee break e networking.' },
];

export const SPEAKERS = [
  { name: 'Cássia Albuquerque', role: 'Psicóloga Organizacional e consultora do Oporto Forte Group', bio: 'Especialista em Carreira, Liderança e Empregabilidade e criadora do Fator X da Carreira. Atualmente atua fortemente junto às empresas nos temas de bem-estar e saúde mental. Foi vice-presidente e diretora da ABRH/PE (2006–2013) e consultora sênior de RH na Deloitte.' },
  { name: 'Mário Melo', role: 'Especialista em Saúde Mental no Trabalho e Riscos Psicossociais', bio: 'Especialista em NR-1 e Lei 14.457/22. Atua em Psicologia Clínica e Organizacional, Desenvolvimento Humano e Treinamentos.' },
];

export const SPONSORS = [
  { name: 'Oporto Forte Group', tier: 'Organização', url: 'https://oportofortegroup.com' },
  { name: 'Instituto do Tênis', tier: 'Causa solidária', url: '' },
];

export const FAQS = [
  { q: 'Onde é o evento?', a: 'No Hub Plural Espinheiro: Av. Gov. Agamenon Magalhães, 2939, Espinheiro, Recife - PE.' },
  { q: 'Como faço check-in?', a: 'Na receção, leia o QR code do dia com a câmara do telemóvel (abre a app e faz o check-in) ou introduza o código na aba Mais > Check-in.' },
  { q: 'Como funciona o networking?', a: 'Crie o seu perfil, procure participantes ou veja as sugestões, envie um pedido de conexão. Quando aceite, podem trocar mensagens e contactos.' },
  { q: 'O que é a entrada solidária?', a: 'Em vez de ingresso, leve um par de tênis ou um voucher para o Instituto do Tênis. A entrega é feita no credenciamento e há uma entrega simbólica das doações ao final do painel.' },
  { q: 'Como recebo avisos?', a: 'Ative as notificações quando a app pedir. Mudanças e atrasos aparecem em tempo real na aba Início.' },
  { q: 'Preciso de instalar algo?', a: 'Não. É uma web app: abra o link e, se quiser, use "Adicionar ao ecrã principal".' },
];

export const INTERESTS = [
  'Saúde mental', 'Gestão de pessoas', 'NR-1', 'Riscos psicossociais', 'Portugal', 'Europa',
  'Tecnologia', 'Inovação', 'Liderança', 'RH', 'Investimento', 'Sustentabilidade',
];

export const POINTS = { checkin: 50, favorite: 5, connect: 20, message: 2, vote: 10, question: 15, profile: 30 };
