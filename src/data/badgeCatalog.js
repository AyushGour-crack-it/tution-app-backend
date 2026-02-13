export const badgeCatalogSeed = [
  // Academic (15)
  { key: "homework_hero", title: "Homework Hero", description: "5 assignments complete.", category: "academic", rarity: "common", xpValue: 20, hidden: false },
  { key: "quick_learner", title: "Quick Learner", description: "First correct answer in class.", category: "academic", rarity: "common", xpValue: 20, hidden: false },
  { key: "eighty_achiever", title: "80% Achiever", description: "Score 80% once.", category: "academic", rarity: "common", xpValue: 30, hidden: false },
  { key: "doubt_destroyer", title: "Doubt Destroyer", description: "Ask 10 meaningful doubts.", category: "academic", rarity: "common", xpValue: 30, hidden: false },
  { key: "concept_clarity", title: "Concept Clarity", description: "Full marks in one concept test.", category: "academic", rarity: "common", xpValue: 50, hidden: false },
  { key: "speed_solver", title: "Speed Solver", description: "Finish first with 80%+.", category: "academic", rarity: "common", xpValue: 50, hidden: false },
  { key: "ninety_master", title: "90% Master", description: "Score 90% in a test.", category: "academic", rarity: "rare", xpValue: 120, hidden: false },
  { key: "rank_riser", title: "Rank Riser", description: "Improve 20% from last test.", category: "academic", rarity: "rare", xpValue: 120, hidden: false },
  { key: "subject_specialist", title: "Subject Specialist", description: "3 tests above 85%.", category: "academic", rarity: "epic", xpValue: 150, hidden: false },
  { key: "top_ranker", title: "Top Ranker", description: "Rank 1 in monthly test.", category: "academic", rarity: "epic", xpValue: 150, hidden: false },
  { key: "academic_beast", title: "Academic Beast", description: "95% in one test.", category: "academic", rarity: "epic", xpValue: 200, hidden: false },
  { key: "comeback_titan", title: "Comeback Titan", description: "Below 60% to 85%+.", category: "academic", rarity: "epic", xpValue: 200, hidden: false },
  { key: "untouchable", title: "Untouchable", description: "95%+ for 3 months.", category: "academic", rarity: "legendary", xpValue: 450, hidden: false },
  { key: "academic_overlord", title: "Academic Overlord", description: "Rank 1 for 6 months.", category: "academic", rarity: "legendary", xpValue: 450, hidden: false },
  { key: "grand_scholar", title: "The Grand Scholar", description: "95%+ for 1 full year.", category: "academic", rarity: "mythic", xpValue: 1000, annualCap: 2, hidden: false },

  // Consistency & Discipline (10)
  { key: "streak_7", title: "7 Day Streak", description: "Consistent 7-day run.", category: "consistency", rarity: "common", xpValue: 20, hidden: false },
  { key: "on_time_student", title: "On-Time Student", description: "Punctual attendance.", category: "consistency", rarity: "common", xpValue: 30, hidden: false },
  { key: "streak_30", title: "30 Day Streak", description: "30-day consistency.", category: "consistency", rarity: "common", xpValue: 50, hidden: false },
  { key: "homework_streak", title: "Homework Streak", description: "Homework streak for 1 month.", category: "consistency", rarity: "rare", xpValue: 120, hidden: false },
  { key: "never_late_2m", title: "Never Late", description: "No late marks for 2 months.", category: "consistency", rarity: "rare", xpValue: 120, hidden: false },
  { key: "attendance_100_3m", title: "100% Attendance", description: "3 months full attendance.", category: "consistency", rarity: "epic", xpValue: 150, hidden: false },
  { key: "fee_discipline_pro", title: "Fee Discipline Pro", description: "On-time fee for 6 months.", category: "consistency", rarity: "epic", xpValue: 150, hidden: false },
  { key: "iron_consistency", title: "Iron Consistency", description: "6-month consistency run.", category: "consistency", rarity: "epic", xpValue: 200, hidden: false },
  { key: "year_warrior", title: "Year Warrior", description: "1 year continuous consistency.", category: "consistency", rarity: "legendary", xpValue: 450, hidden: false },
  { key: "loyal_legend", title: "Loyal Legend", description: "2 years with zero break.", category: "consistency", rarity: "legendary", xpValue: 450, hidden: false },

  // Personality & Social (10)
  { key: "polite_star", title: "Polite Star", description: "Respectful behaviour in class.", category: "personality", rarity: "common", xpValue: 20, hidden: false },
  { key: "helpful_human", title: "Helpful Human", description: "Frequently helps classmates.", category: "personality", rarity: "common", xpValue: 20, hidden: false },
  { key: "energy_booster", title: "Class Energy Booster", description: "Boosts class morale.", category: "personality", rarity: "common", xpValue: 30, hidden: false },
  { key: "confident_speaker", title: "Confident Speaker", description: "Strong speaking confidence.", category: "personality", rarity: "common", xpValue: 50, hidden: false },
  { key: "team_player_pro", title: "Team Player Pro", description: "Consistent team contribution.", category: "personality", rarity: "rare", xpValue: 120, hidden: false },
  { key: "positive_aura", title: "Positive Aura", description: "Positive influence in class.", category: "personality", rarity: "rare", xpValue: 120, hidden: false },
  { key: "mini_professional", title: "Mini Professional", description: "Professional work attitude.", category: "personality", rarity: "epic", xpValue: 150, hidden: false },
  { key: "class_leader", title: "Class Leader", description: "Leadership by action.", category: "personality", rarity: "epic", xpValue: 200, hidden: false },
  { key: "golden_presence", title: "Golden Presence", description: "Class-voted presence badge.", category: "personality", rarity: "legendary", xpValue: 450, hidden: false },
  { key: "main_character_energy", title: "Main Character Energy", description: "Ultra peer-voted identity badge.", category: "personality", rarity: "mythic", xpValue: 1000, annualCap: 2, hidden: false },

  // Pop-culture inspired (10)
  { key: "tech_genius", title: "Tech Genius", description: "Inspired inventor mindset.", category: "inspired", rarity: "common", xpValue: 50, hidden: false },
  { key: "master_analyst", title: "Master Analyst", description: "Inspired detective logic.", category: "inspired", rarity: "rare", xpValue: 120, hidden: false },
  { key: "silent_strategist", title: "Silent Strategist", description: "Quiet strategic execution.", category: "inspired", rarity: "rare", xpValue: 120, hidden: false },
  { key: "never_give_up_spirit", title: "Never Give Up Spirit", description: "Comeback through persistence.", category: "inspired", rarity: "epic", xpValue: 150, hidden: false },
  { key: "discipline_captain", title: "Discipline Captain", description: "Elite discipline control.", category: "inspired", rarity: "epic", xpValue: 200, hidden: false },
  { key: "shadow_worker", title: "Shadow Worker", description: "Silent consistent performer.", category: "inspired", rarity: "common", xpValue: 30, hidden: false },
  { key: "logic_lord", title: "Logic Lord", description: "Strong analytical thinking.", category: "inspired", rarity: "epic", xpValue: 150, hidden: false },
  { key: "brainstorm_beast", title: "Brainstorm Beast", description: "High-output idea contributor.", category: "inspired", rarity: "epic", xpValue: 200, hidden: false },
  { key: "night_study_ninja", title: "Night Study Ninja", description: "Consistent night revision performer.", category: "inspired", rarity: "rare", xpValue: 120, hidden: false },
  { key: "the_prodigy", title: "The Prodigy", description: "Break class record benchmark.", category: "inspired", rarity: "legendary", xpValue: 450, hidden: false },

  // Secret / hidden (5)
  { key: "ice_mind", title: "Ice Mind", description: "Top score in surprise test.", category: "secret", rarity: "epic", xpValue: 150, hidden: true },
  { key: "hidden_potential", title: "Hidden Potential", description: "Sudden major uplift.", category: "secret", rarity: "epic", xpValue: 200, hidden: true },
  { key: "the_anomaly", title: "The Anomaly", description: "Breaks expected pattern.", category: "secret", rarity: "legendary", xpValue: 450, hidden: true },
  { key: "calm_under_pressure", title: "Calm Under Pressure", description: "3 surprise tests with high score.", category: "secret", rarity: "epic", xpValue: 200, hidden: true },
  { key: "the_immortal", title: "The Immortal", description: "Own 3+ legendary-level badges.", category: "secret", rarity: "mythic", xpValue: 1000, annualCap: 2, hidden: true },

  // Fun & Event (1)
  {
    key: "holi_2026",
    title: "Holi26",
    description: "Special event badge for Holi 2026 participation.",
    category: "fun_event",
    rarity: "rare",
    xpValue: 0,
    hidden: false,
    imageUrl: "/badges/holi-2026.svg"
  },
  {
    key: "tanjiro_3x3",
    title: "Tanjiro 3x3",
    description: "Study 3 hours at home for 3 continuous days.",
    category: "fun_event",
    rarity: "epic",
    xpValue: 0,
    hidden: false,
    imageUrl: "/badges/tanjirocard.png"
  }
];
