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
    'Saúde mental no trabalho: a Europa, o Brasil e Pernambuco lado a lado',
    'Gestão humanizada, ética e NR-1: riscos psicossociais',
    'Prevenção, liderança e formação com acompanhamento no dia a dia',
    'Comunicação e compreensão intercultural nas equipas',
    'Boas práticas: um plano e um programa integrado',
    'Tecnologia a apoiar a escuta e a continuidade, sem substituir a relação humana',
    'Conexão com FIB (Felicidade Interna Bruta) e ESG',
  ],
};

// Horários em hora de Recife (UTC-3). Fonte: roteiro de moderação V3 (3/11/2026).
const P = {
  nubia: { name: 'Núbia Correia', role: 'Moderação' },
  ana: { name: 'Ana Pinho', role: 'Mi Hub Education, Portugal: comunicação, aprendizagem linguística e compreensão intercultural nas equipas' },
  patricia: { name: 'Patrícia Cardoso', role: 'Oporto Forte Group, Portugal: a formação em Portugal' },
  mario: { name: 'Mário Melo', role: 'Gestão humanizada, ética e NR-1: riscos psicossociais' },
  alliny: { name: 'Alliny Freire', role: 'Psicóloga organizacional: perspetiva clínica e preventiva, boas práticas' },
  renato: { name: 'Renato Menezes', role: 'Tecnologia e Inovação, Oporto Forte Group' },
  silva: { name: 'Silva Jonathan', role: 'Equipa de Tecnologia, Oporto Forte Group' },
};
const PAINELISTAS = [P.ana, P.patricia, P.mario, P.alliny];
export const SESSIONS = [
  { id: 'e1', tag: 'Receção', day: 'd1', start: '15:30', end: '16:30', room: 'Auditório', title: 'Credenciamento e entrega solidária', speaker: 'Equipe OFG', desc: 'Check-in via QR code e entrega do par de tênis ou voucher para o Instituto do Tênis.' },
  { id: 'e2', tag: 'Institucional', day: 'd1', start: '16:30', end: '16:40', room: 'Auditório', title: 'Abertura do evento', speaker: 'Nadja Ferreira', desc: 'Abertura, apresentação da OFG e da ONG.' },
  { id: 'e3', tag: 'Institucional', day: 'd1', start: '16:40', end: '16:50', room: 'Auditório', title: 'A causa e os projetos da ONG', speaker: 'Mónica Barros', desc: 'Apresentação da ONG e dos seus projetos.' },
  { id: 'e4', tag: 'Institucional', day: 'd1', start: '16:50', end: '16:55', room: 'Auditório', title: 'Vídeo: saúde mental nas empresas em números', speaker: 'Nadja Ferreira', desc: 'Transição para o painel: vídeo com os indicadores e passagem da palavra à moderadora.' },
  { id: 'e5', tag: 'Painel', day: 'd1', start: '16:55', end: '17:05', room: 'Auditório', title: 'Abertura do painel e apresentação dos painelistas', speaker: 'Moderação: Núbia Correia', desc: 'Recapitulação dos indicadores, uma pergunta para a plateia e a apresentação dos painelistas.', people: [P.nubia, ...PAINELISTAS] },
  { id: 'e6', tag: 'Painel', day: 'd1', start: '17:05', end: '17:15', room: 'Auditório', title: 'Experiência multicultural e a pergunta inicial', speaker: 'Moderação: Núbia Correia', desc: 'Numa palavra ou frase, como definiria saúde mental nas organizações? Respondem Ana Pinho, Patrícia Cardoso, Mário Melo e Alliny Freire.', people: PAINELISTAS },
  { id: 'e7', tag: 'Painel', day: 'd1', start: '17:15', end: '17:25', room: 'Auditório', title: 'Perguntas aos painelistas', speaker: 'Moderação: Núbia Correia', desc: 'Europa e o cuidado com as equipas, prevenção e formação com acompanhamento, preparação das empresas para quem chega fragilizado, e boas práticas num plano e programa integrado.', people: PAINELISTAS },
  { id: 'e8', tag: 'Painel', day: 'd1', start: '17:25', end: '17:40', room: 'Auditório', title: 'A tecnologia como aliada: a solução integrada OFG', speaker: 'Renato Menezes e Silva Jonathan', desc: 'Como pode a tecnologia apoiar a escuta, o acesso a recursos e a continuidade das iniciativas, sem substituir a relação humana?', people: [P.renato, P.silva] },
  { id: 'e9', tag: 'Painel', day: 'd1', start: '17:40', end: '17:55', room: 'Auditório', title: 'Perguntas da plateia', speaker: 'Moderação: Núbia Correia', desc: 'Envie a sua pergunta na aba Ao Vivo e vote nas dos colegas.' },
  { id: 'e10', tag: 'Institucional', day: 'd1', start: '17:55', end: '18:00', room: 'Auditório', title: 'Reflexão final e encerramento', speaker: 'Núbia Correia e Nadja Ferreira', desc: 'O desafio para 2027 não é apenas fazer mais, é fazer diferente. Encerramento com Nadja Ferreira.' },
  { id: 'e11', tag: 'Networking', day: 'd1', start: '18:00', end: '18:30', room: 'Auditório', title: 'Entrega das doações, foto oficial e coffee break', speaker: '', desc: 'Entrega simbólica das doações ao Instituto do Tênis, foto oficial e networking.' },
];

export const SPEAKERS = [
  { name: 'Núbia Correia', role: 'Moderadora · Consultant Partner do Oporto Forte Group', bio: 'Especialista em Gestão de Projetos, certificada pela Stanford University, mestre em Administração, professora convidada da FGV e PUC-Rio, mediadora de conflitos e Presidente da Associação Empresarial BrasileiroSou®. Tem vasta experiência em grandes empresas multinacionais e é coautora do livro "Potencialidades Humanas favorecendo a Saúde Mental e o Trabalho".' },
  { name: 'Mário Melo', role: 'Consultor, docente e palestrante', bio: 'Atua em Gestão de Pessoas, Liderança, Saúde Mental no Trabalho e Riscos Psicossociais. Administrador e pós-graduado em Gestão de Recursos Humanos, com mais de 35 anos de experiência profissional, destacando-se a sua carreira na Bayer e o trabalho na prevenção do assédio e na promoção de ambientes de trabalho mais saudáveis e seguros.' },
  { name: 'Alliny Freire', role: 'Psicóloga organizacional · Partner Consultant do Oporto Forte Group', bio: 'Especialista em Gestão de Pessoas e Gestão Estratégica de Negócios, com mais de 17 anos de experiência. Atua como consultora, mentora e instrutora do Senac, com foco no desenvolvimento humano, na transformação organizacional e na promoção da saúde mental no trabalho.' },
  { name: 'Patrícia Cardoso', role: 'Diretora Administrativa e de Desenvolvimento de Negócios · Oporto Forte Group, Portugal', bio: 'Tem mais de 20 anos de experiência em gestão e formação corporativa, destacando-se no desenvolvimento de lideranças e na valorização das pessoas nas organizações.' },
  { name: 'Ana Pinho', role: 'Fundadora e CEO da Mi Hub Education, Portugal', bio: 'Doutorada em Didática das Línguas Estrangeiras. Colabora com departamentos de RH no desenvolvimento de competências linguísticas e de comunicação intercultural em equipas de diferentes nacionalidades.' },
  { name: 'Renato Menezes', role: 'Tecnologia e Inovação · Oporto Forte Group', bio: 'Braço de Tecnologia e Inovação da OFG, Engenheiro de Software e Especialista em Automação com mais de 10 anos de experiência. Responsável pelo desenvolvimento de plataformas digitais, automação de processos e soluções com Inteligência Artificial, sobre uma base sólida em Engenharia de Controle e Automação, IoT e Indústria 4.0, com atuação em projetos no Brasil e na Europa.' },
  { name: 'Silva Jonathan', role: 'Líder da Equipa de Tecnologia · Oporto Forte Group', bio: 'Braço tecnológico da OFG e líder da Equipa de Tecnologia, responsável pela plataforma HDS. Tem carreira em estratégia digital, produto e software, desenvolvendo soluções com inteligência artificial para gestão de pessoas no Brasil, em Portugal e na Espanha.' },
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
