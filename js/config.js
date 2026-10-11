/* =====================================================================
   HUMAN HOURS MUSEUM · content file
   ---------------------------------------------------------------------
   Henry: this is the only file you need to edit for words.

   - draft  : sentences copied from YOUR formative proposal (your own
              writing). Rewrite them into your final explanation.
   - ask    : a question to push your thinking. Shown only while
              DRAFT_MODE is true. Delete or ignore.
   - THESIS / ENDING / translation lines: yours to write.
   - When you are ready to submit, set DRAFT_MODE to false.

   Rubric reminder: "All explanations are your original work, without
   the use of AI." Claude did not write any draft/THESIS/ENDING text.
   ===================================================================== */
var HH = window.HH = window.HH || {};

HH.DRAFT_MODE = false;

HH.SITE = {
  name: "Human Hours",
  subtitle: "A museum of Generation Z",
  year: 2050,
  curator: "Henry",
  course: "English 11 · Q1\u00a0Summative\u00a02 · Lost Generation Museum",
  stein: "“You are all a lost generation.”",
  steinBy: "Gertrude Stein to Ernest Hemingway",
  question: "Is YOUR generation “lost”???",
  genZ: "Generation Z · born 1997–2012",
  // Henry writes these two. Leave "" until then.
  THESIS: "Gen z is a lost generation. Today, our generation is using AI more and more. However, depending on AI, in fact, weakens our creativity, independence, and meaningful experiences. Therefore, we are lost.",
  THESIS_ASK: "한 문장으로: Gen Z는 lost다, 왜냐하면 ___. 여섯 방이 다 이 문장을 증명해야 해.",
  ENDING: "",
  exitWindow: "assets/bd-7-seoul.jpg",
  ENDING_ASK: "마지막 방이 태권도야. 2050년에 태어난 사람에게 마지막으로 하고 싶은 말은?",
  madeBy: [
    ["Artifacts, explanations, voice", "Henry"],
    ["3D site code and visuals", "built with Claude (AI). No explanation text was written by AI."]
  ]
};

/* Corridor layout shared by the engine and every room (meters). */
HH.LAYOUT = {
  spacing: 12,     // distance along the corridor between rooms
  wallX: 6,        // corridor half-width (walls at x = -6 and x = +6)
  ceiling: 6.4,
  eye: 1.62,
  viewDist: 4.6,   // visitor stands this far from the wall when looking at a room
  firstZ: -12      // z of room 1; room n is at firstZ - (n-1)*spacing
};

/* Section headings come straight from the rubric's three questions. */
HH.SLOTS = [
  { key: "why",      label: "Why I chose it" },
  { key: "means",    label: "What it means to me" },
  { key: "supports", label: "How it supports my argument" }
];

HH.EXHIBITS = [
  {
    n: 1, slug: "spider", side: -1,
    room: "The Frame Room",
    title: "Spider-Man: Into the Spider-Verse",
    required: "Required · Visual art",
    kind: "Animated film, 2018",
    meta: [
      "Sony Pictures Animation · dir. Bob Persichetti, Peter Ramsey, Rodney Rothman",
      "Main character Miles Morales is a teenager"
    ],
    human: { label: "Human time", short: "1 SEC = 1 WEEK", value: "About 1 second of film per animator, per week", note: "A typical animated film is about 4 seconds per week. (/Film)" },
    machine: { label: "Machine time", short: "1 PROMPT", value: "AI video tools like Sora: a “Spider-Man style” clip from one text prompt" },
    slots: {
      why: {
        text: "I chose this movie because it is one of my favorite childhood memories.",
        draft: "This movie is one of my favorite childhood memories.",
        ask: "처음 본 게 언제, 어디서, 누구랑이었어? “favorite memory” 대신 진짜 장면 하나를 써봐."
      },
      means: {
        text: "When I was in elementary school, I watched this movie at home with my dad. It was pretty fun. In the movie, the main character Miles Morales is a teenager like me, and this makes me feel more connected to the movie.",
        draft: "In this movie, the main character Miles Morales is a teenager just like me, and his adventure is illustrated like scenes from comic books that are hand drawn.",
        ask: "Miles가 “just like me”인 건 정확히 어떤 점이야? 네가 제일 좋아하는 장면은?"
      },
      supports: {
        text: "To make this movie, hundreds of artists spent years to illustrate each scene by drawing with their own hands. However, today, AI tools are generating videos in minutes that look as good as human-made. When AI can generate the stories and movies from my childhoods easily, my personal memories start to feel less personal and meaningful. It means that my memories still exist, but their originalities may be lost. This is why I believe Gen Z is a lost generation.",
        draft: "It took hundreds of artists years to make it, but today, AI video tools like Sora can make a “Spider-Man style” video in a few minutes. If AI can make movies from our childhood memories, our memories don’t feel special anymore. Then, we lost it.",
        ask: "“We lost it”의 it은 뭐야? 기억이야, 영화야, 아니면 다른 거야? 라벨의 “1초 = 1주” 숫자를 쓸지도 정해봐."
      }
    },
    links: [
      { label: "Watch the official trailer", sub: "YouTube", url: "https://youtu.be/g4Hbz2jLxvQ", kind: "video" }
    ],
    sources: [
      ["Spider-Man: Into the Spider-Verse, official trailer. Sony Pictures Animation.", "https://youtu.be/g4Hbz2jLxvQ"],
      ["“Here’s The Technical Reason This Movie Looks So Incredible.” /Film.", "https://www.slashfilm.com/562748/into-the-spider-verse-technique"],
      ["Post Malone and Swae Lee. “Sunflower (Spider-Man: Into the Spider-Verse).” 2018. Plays in this room.", "https://youtu.be/ApXoWvfEYVU"]
    ],
    audio: "audio/room1.mp3",
    media: { photo: "assets/spiderverse.jpg", song: "audio/sunflower.mp3", songTitle: "Sunflower · Post Malone, Swae Lee", backdrop: "assets/bd-1-rooftops.jpg" }
  },
  {
    n: 2, slug: "yuleum", side: 1,
    room: "The Recording Booth",
    title: "“Hold My Hand”",
    required: "Required · Written work by Gen Z",
    kind: "Song lyrics",
    meta: [
      "Yuleum (율음) · born July 4, 2009",
      "Track 2 on CICADA, released Oct. 17, 2024. He was 15."
    ],
    human: { label: "Human time", short: "AGE 15 · 10 TRACKS", value: "A 15-year-old’s second full album, 10 tracks, his own lyrics" },
    machine: { label: "Machine time", short: "UNDER 1 MINUTE", value: "AI apps like Suno: a whole rap song in under a minute" },
    lyrics: [
      "I'm here to testify,",
      "and make this thirsty ass rap fans satisfied",
      "난 큰 꿈을 가졌고, 이뤄야 하니까",
      "넌 비켜, 이름도 모르는 꼼수쟁이야,",
      "공기가 너의 fan이야",
      "난 사실 음악밖에 몰라, maniac",
      "그냥 발만 담그는 거는 재미가",
      "없으니까 이왕 온 거 I'm diving in",
      "지금 내 포부는 중학생 수준이 아니지"
    ],
    // Henry's English translation, one line per lyric line. "" = not written yet.
    translation: [
      "I’m here to testify,",
      "And satisfy these thirsty-ass rap fans tonight.",
      "I got big dreams, and I gotta make ’em come true,",
      "So move aside, you no-name hustler with your cheap-ass moves.",
      "The only fan you got is the air around you.",
      "Truth is, music’s all I know, I’m a maniac,",
      "Dippin’ just a toe in the water? Man, I ain’t into that.",
      "Since I’m already here, I’m goin’ all in, I’m divin’ deep,",
      "My ambitions way beyond what a middle school kid could dream."
    ],
    highlight: [2, 7],   // lines to glow brighter (big dream, diving in)
    slots: {
      why: {
        text: "I included this song because I was impressed that someone around my age could write his own lyrics and share his dreams with the world through music. I think it takes a lot of passion and courage to express yourself like that.",
        draft: "Yuleum is a 17-year-old Korean rapper who raps about his big dream and the way he achieves it. He says he only knows music, and he is even “diving in” to music.",
        ask: "가사 중에 네가 제일 꽂힌 줄 하나는? 왜 하필 그 줄이야?"
      },
      means: {
        text: "This song means a lot to me because Yuleum is a 17-year-old Korean rapper who raps about his big dreams and how he plans to achieve them. He says that he only knows music and that he is even “diving in” to music, which shows his ambition.",
        draft: "For me, it was so impressive that someone in my age can write and share his ambition to the world through his music.",
        ask: "네가 “diving in” 하고 있는 건 뭐야? 이 가사가 너한테 자극이야, 부러움이야, 아니면 둘 다야?"
      },
      supports: {
        text: "This song supports my argument because AI tools like Suno can now generate an entire rap song in less than a minute. Teenagers like Yuleum are just starting to make their own music, but AI is already starting to take over the music industry. I think this makes it harder for young artists to feel that their creativity and dreams are special. Our generation is getting lost because AI is taking over our creativity.",
        draft: "But now AI apps like Suno can make a whole rap song in less than one minute. Teenagers like Yuleum are just starting making their own music, but Ai is also starting to take it over. That’s why our generation is lost.",
        ask: "“중학생 수준이 아닌 포부”를 AI는 가질 수 있을까? 여기서 잃어버리는 건 율음이야, 듣는 우리야?"
      }
    },
    links: [
      { label: "Play “Hold My Hand”", sub: "YouTube", url: "https://youtu.be/n2wIrPmj1BA", kind: "audio" }
    ],
    sources: [
      ["Yuleum. “Hold My Hand.” CICADA, 2024. YouTube.", "https://youtu.be/n2wIrPmj1BA"],
      ["율음 (Yuleum) profile, birth date. 더위키.", "https://thewiki.kr/w/%EC%9C%A8%EC%9D%8C"],
      ["CICADA album review and track list. brunch.", "https://brunch.co.kr/@breakevenpoint/127"]
    ],
    audio: "audio/room2.mp3",
    media: { cover: "assets/cicada-cover.jpg", song: "audio/yuleum-hold-my-hand.mp3", voiceAt: 30.5, backdrop: "assets/bd-2-booth.jpg" }
  },
  {
    n: 3, slug: "ban", side: -1,
    room: "The Blackout",
    title: "Australia’s Social Media Ban for Under-16s",
    required: "Required · News about someone my age",
    kind: "News article · BBC News",
    meta: [
      "Took effect Dec. 10, 2025",
      "Teens under 16 lost their accounts on 10 platforms"
    ],
    human: { label: "Human time", short: "EVERY DAY", value: "Teens under 16 who used these apps every day" },
    machine: { label: "Machine time", short: "10 PLATFORMS · A$49.5M", value: "10 platforms ordered to remove them. Fines up to A$49.5 million." },
    facts: {
      date: "2025-12-10",
      platforms: ["Facebook", "Instagram", "Kick", "Reddit", "Snapchat", "Threads", "TikTok", "Twitch", "X", "YouTube"],
      fine: "A$49.5 million",
      // Optional: left empty on purpose (Henry chose not to add a teen).
      teenName: "",
      teenAge: "",
      teenQuote: ""
    },
    slots: {
      why: {
        text: "I included this article because Australia’s social media ban shows how seriously governments are starting to treat the negative effects of social media on young people. The Australian government said the ban would reduce the harmful effects of social media features that encourage young people to spend more time on screens and expose them to harmful content.",
        draft: "Teens my age are using social media everyday. It’s our daily messenger for now.",
        ask: "내일 한국에서 같은 법이 생기면 네가 제일 먼저 잃는 앱은? 그 앱에서 뭐가 제일 아쉬울까?"
      },
      means: {
        text: "This news article means a lot to me because social media is a big part of my daily life. Teens my age use social media every day. It is not just for entertainment; it is also how we communicate and stay connected with each other.",
        draft: "However, adults, we made the decision without knowing about us and even asking us, are just forcing us to now use social media.",
        ask: "체크: “forcing us to now use”는 “not use”를 쓰려던 거야?"
      },
      supports: {
        text: "This article supports my argument because social media has become such an essential part of our lives that governments are now restricting our access to it. Adults are making decisions about something that affects our daily lives, and I wonder whether teenagers’ opinions are being fully considered. I understand that social media can harm our health, but I also think it is important for adults to understand why we depend on it. This makes me wonder whether our generation has become so dependent on social media that we can no longer manage its effects on our own.",
        draft: "This shows that our generation is so lost in social media that the government and ‘the adults’ think that they had to control over us.",
        ask: "금지법은 우리가 lost라는 증거야, 아니면 어른들이 그렇게 믿는다는 증거야? 네 생각은 어느 쪽이야?"
      }
    },
    links: [
      { label: "Read the BBC article", sub: "BBC News", url: "https://www.bbc.com/news/articles/cwyp9d3ddqyo", kind: "article" }
    ],
    sources: [
      ["BBC News article on Australia’s under-16 social media ban.", "https://www.bbc.com/news/articles/cwyp9d3ddqyo"],
      ["“Australia bans under-16s from social media in world-first crackdown.” AFP via Citizen Digital, Dec. 2025.", "https://citizen.digital/article/australia-bans-under-16s-from-social-media-in-world-first-crackdown-n374239"],
      ["“GG EZ.” Lyrics video (EN/KR/JP). Plays in this room.", "https://youtu.be/6lN51mwvuA8"]
    ],
    audio: "audio/room3.mp3",
    media: { photo: "assets/sns-ban.jpg", song: "audio/gg-ez.mp3", songTitle: "GG EZ", backdrop: "assets/bd-3-phones.jpg" }
  },
  {
    n: 4, slug: "ypt", side: 1,
    room: "The Study Hall",
    title: "My Pure Study Time",
    required: "Free choice",
    kind: "Yeolpumta (열품타) study timer · my screenshots",
    meta: [
      "Pure study time (순공시간): only the minutes I really studied",
      "Sep. 28 – Oct. 11, 2026 · SAT, 5 AP classes, US History, English 11"
    ],
    human: { label: "Human time", short: "2,635 MINUTES", value: "43 h 55 m in 7 logged days. Best day: 10 h 56 m (Oct. 11)" },
    machine: { label: "Machine time", short: "SECONDS", value: "AI: a hard math problem in minutes, an essay in seconds" },
    facts: {
      days: [
        { date: "9/28", min: 497 },
        { date: "9/29", min: 303 },
        { date: "10/1", min: 399 },
        { date: "10/3", min: 336 },
        { date: "10/8", min: 263 },
        { date: "10/10", min: 181 },
        { date: "10/11", min: 656 }
      ],
      totalMin: 2635,
      bestDay: "10:56:24",
      dDay: "",
      subjects: ["SAT Reading & Writing", "SAT Math", "AP Chemistry", "AP Biology", "AP Psychology", "AP Calculus BC", "US History", "English 11"]
    },
    slots: {
      why: {
        text: "I included this artifact because it represents how important studying and academic achievement are for students in my generation. The app helps me focus on studying, but it also shows how much attention we give to study hours and rankings.",
        draft: "Yeolpumta(YPT) is a Korean study app that records how many hours I really study and ranks me with other students using the same app.",
        ask: "스크린샷 속 숫자 하나를 골라봐. 10시간 56분인 날은 무슨 날이었어?"
      },
      means: {
        text: "Yeolpumta means a lot to me because it records how many hours I actually study and ranks me with other students using the same app. As a student, studying is one of the most important parts of my daily life, and YPT helps me keep track of my progress.",
        draft: "",
        ask: "proposal에 이 칸에 맞는 문장이 아직 없어. 순공시간 랭킹이 너한테 어떤 기분이야? 뿌듯함, 압박, 아니면 숙제?"
      },
      supports: {
        text: "This artifact supports my argument because AI can now solve difficult math problems in minutes and write sophisticated essays in seconds. Students spend years developing academic skills, but AI can already perform many of these tasks. This makes me question what all our studying will mean in the future if AI can do so many things that we spend years learning to do. Our generation is becoming lost because we are working hard to develop skills that AI is already learning to perform.",
        draft: "For students, studying is one of the most important priority, but today AI can solve some difficult math problems in about few minutes and write sophisticated essays in seconds. Students are spending their whole teenage years for studying skills, but AI today already has these skills. That’s why our generation is so lost.",
        ask: "2,635분을 공부한 너는 lost야? 아니면 그 시간을 AI와 비교하는 세상이 lost야?"
      }
    },
    links: [],
    sources: [
      ["My Yeolpumta (열품타) app: calendar and timer screenshots, Oct. 2026.", ""],
      ["NewJeans. “New Jeans.” 2023. Plays in this room.", "https://youtu.be/G8GEpK7YDl4"]
    ],
    audio: "audio/room4.mp3",
    media: { calendar: "assets/ypt-calendar.jpg", timer: "assets/ypt-timer.jpg", song: "audio/newjeans.mp3", songTitle: "New Jeans · NewJeans", backdrop: "assets/bd-4-studycafe.jpg" }
  },
  {
    n: 5, slug: "spotify", side: -1,
    room: "The Algorithm Room",
    title: "My Spotify",
    required: "Free choice",
    kind: "My Spotify library · screenshot",
    meta: [
      "Favorite artists, recent plays, and the mixes Spotify made for me",
      "Plus The Velvet Sundown, a band that turned out to be AI"
    ],
    human: { label: "Human time", short: "1 PLAYLIST · MINE", value: "My own playlist: songs I picked myself" },
    machine: { label: "Machine time", short: "1.07M LISTENERS · AI", value: "The Velvet Sundown: over 1 million monthly listeners before it said it was AI (July 2025)" },
    facts: {
      favorites: ["Lil Moshpit", "HAON", "RESCENE", "KC", "HANRORO"],
      recents: [
        { song: "3 STEPS FORWARD", artist: "" },
        { song: "KEUNG", artist: "C JAMM" },
        { song: "Nostalgia", artist: "BIG Naughty" },
        { song: "Runaway", artist: "RESCENE" }
      ],
      nowPlaying: { song: "yours", artist: "Damons year (데이먼스 이어)" },
      library: ["C JAMM", "BewhY", "Okasian", "KC", "RESCENE", "E SENS", "Bruno Mars", "G-DRAGON", "Coogie", "YANGHONGWON", "BlackNut"],
      mixes: ["RESCENE Mix", "BIG Naughty Mix", "Hip Hop Mix", "Chill Mix", "R&B Mix"],
      velvet: { listeners: "1.07 million monthly listeners", when: "July 2025", quote: "a synthetic music project guided by human creative direction" },
      // Henry: paste your playlist link here, e.g. "https://open.spotify.com/playlist/..."
      playlist: "https://open.spotify.com/playlist/1FosZRplReE3hyGpekQvkv"
    },
    slots: {
      why: {
        text: "I included my Spotify account because it shows how technology influences the music we listen to. Honestly, many of the songs I listen to are recommended by Spotify’s algorithm. I also found it surprising that an AI-generated music project called The Velvet Sundown attracted many listeners before its AI origins became widely known.",
        draft: "I like listening to music.",
        ask: "좋아하는 아티스트 다섯 중에 알고리즘 말고 네가 직접 찾은 사람은 누구야? 어떻게 찾았어?"
      },
      means: {
        text: "Spotify means a lot to me because I often relax while listening to music. I listen to music on Spotify every day, and it is an important part of my daily routine.",
        draft: "I listen to music on Spotify everyday, but honestly the songs that I listen are typically chosen not by me but by the algorithm.",
        ask: "최근 들은 노래 4곡 중에 네가 고른 건 몇 곡이야? 그 비율을 라벨의 “Songs I found by myself”에 넣어."
      },
      supports: {
        text: "This artifact supports my argument because I think our generation is becoming too dependent on algorithms to choose our music. Instead of always discovering music on our own, we often listen to what platforms recommend to us. Also, when AI-generated music sounds like music made by real artists, it can become difficult to know who actually created it. Our generation is becoming lost because technology is influencing our choices so much that we may lose our independence as listeners and our connection to human artists.",
        draft: "Even more surprisingly, there was an AI band called The Velvet Sundown that got huge amount of listeners on Spotify before people found out it was AI. Our generation doesn’t even pick our own music anymore, and we can’t tell if the artist is real. That’s why we are lost today.",
        ask: "네가 The Velvet Sundown을 들었다면 AI인 걸 알아차렸을까? 좋으면 진짜든 아니든 상관없어?"
      }
    },
    links: [
      { label: "Open my playlist", sub: "Spotify", url: "https://open.spotify.com/playlist/1FosZRplReE3hyGpekQvkv", kind: "audio", key: "playlist" }
    ],
    sources: [
      ["My Spotify library screenshot, Oct. 2026.", ""],
      ["“The Velvet Sundown … one million Spotify monthly listeners.” Digital Music News, July 7, 2025.", "https://www.digitalmusicnews.com/2025/07/07/velvet-sundown-one-million-spotify-monthly-listeners/"],
      ["양홍원 (YANGHONGWON). “사계.” Plays in this room.", "https://youtu.be/SyuR49nbmrw"]
    ],
    audio: "audio/room5.mp3",
    media: { screenshot: "assets/spotify.jpg", song: "audio/yanghongwon-sagye.mp3", voiceAt: 39.5, songTitle: "사계 · 양홍원", backdrop: "assets/bd-5-records.jpg" }
  },
  {
    n: 6, slug: "taekwondo", side: 1,
    room: "The Dojang",
    title: "My Taekwondo 4th Poom Certificate",
    required: "Free choice",
    kind: "Kukkiwon certificate · 4품 (4th Poom)",
    meta: [
      "Issued Jan. 28, 2026 · training since 2013",
      "Certificate number and birth date hidden for privacy"
    ],
    human: { label: "Human time", short: "13 YEARS", value: "13 years in the dojang, 2013 to 2026" },
    machine: { label: "Machine time", short: "0 SECONDS", value: "None. All 13 years were trained in person." },
    facts: {
      since: 2013,
      issued: "2026-01-28",
      years: 13,
      birthRate: [
        { year: 2023, tfr: 0.72 },
        { year: 2024, tfr: 0.75 }
      ]
    },
    slots: {
      why: {
        text: "I included this artifact because it represents something I achieved through my own effort. Unlike something that AI can generate in seconds, my Taekwondo experience required me to show up, practice, and improve consistently over many years. AI cannot go through those experiences for me or earn this achievement on my behalf.",
        draft: "I have trained Taekwondo since 2013. It’s been 13 years since I first stepped into this martial art. I am a 4th degree (or 4th Dan) black belt.",
        ask: "증서에는 4단이 아니라 4품이라고 되어 있어. 문장을 맞게 고쳐. 13년 중에 그만두고 싶었던 날이 있었어?"
      },
      means: {
        text: "My Taekwondo certificate means a lot to me because I have trained in Taekwondo since 2013. It has been 13 years since I first started practicing this martial art, and I am now a fourth-degree black belt. This certificate represents years of practice, discipline, and dedication.",
        draft: "This is the only artificat in my museum that AI can't do for me. It’s because it took exactly myself to dedicate consistently.",
        ask: "네 몸이 아는데 화면으로는 못 배우는 동작 하나를 구체적으로 써봐."
      },
      supports: {
        text: "This artifact supports my argument because it shows the value of real human effort and experience in a world increasingly influenced by technology. However, I worry that fewer children may participate in activities like Taekwondo as Korea’s birth rate declines and young people spend more time on screens. If fewer children continue these traditions, activities that require years of physical practice may gradually become less common. Our generation is becoming lost when we spend more time with technology and less time building real skills through personal experience and dedication.",
        draft: "But today fewer kids go to Taekwondo dojang because of low birth rate in Korea and kids are on screens instead. In the future the demand of Taekwondo will go down, so even the thing AI can’t replace is slowly disappearing. That’s why our generation is lost.",
        ask: "이 방은 네 ‘lost’ 주장의 예외야, 아니면 마지막 증거야? 박물관 끝에서 남기고 싶은 느낌을 정해봐."
      }
    },
    links: [],
    sources: [
      ["My Kukkiwon 4th Poom certificate, Jan. 28, 2026.", ""],
      ["Korea total fertility rate 0.72 (2023), 0.75 (2024). Statistics Korea.", "https://kostat.go.kr"],
      ["BIGBANG. “BANG BANG BANG.” 2015. Plays in this room.", "https://youtu.be/CyrGxvdbR5c"]
    ],
    audio: "audio/room6.mp3",
    media: { certificate: "assets/poom-certificate.jpg", kickVideo: "", song: "audio/bangbangbang.mp3", songTitle: "BANG BANG BANG · BIGBANG", backdrop: "assets/bd-6-dojang.jpg" }
  }
];
