export type Rarity = "common" | "rare" | "epic" | "legendary" | "mythic";

export interface Collectible {
  id: number;
  name: string;
  rarity: Rarity;
  bit: string;
  filename: string;
}

export const COLLECTIBLES: Collectible[] = [
  { id: 1,  name: "67",                      rarity: "mythic",    bit: "scientifically the most popular random number. he goes to a different school you wouldn't know him", filename: "01_67.png" },
  { id: 2,  name: "Carry the 1",             rarity: "common",    bit: "your dad whispered this to himself and felt powerful", filename: "02_Carry_the_1.png" },
  { id: 3,  name: "Remainder Randy",         rarity: "common",    bit: "he didn't fit. he's okay with it. (he's not okay with it)", filename: "03_Remainder_Randy.png" },
  { id: 4,  name: "Long Division Larry",     rarity: "common",    bit: "6 steps minimum or he walks", filename: "04_Long_Division_Larry.png" },
  { id: 5,  name: "NPC Number",              rarity: "common",    bit: "appears in every word problem. has never once been the answer", filename: "05_NPC_Number.png" },
  { id: 6,  name: "Wrong Answer Dan",        rarity: "common",    bit: "raised his hand. should not have raised his hand", filename: "06_Wrong_Answer_Dan.png" },
  { id: 7,  name: "The Check Your Work Guy", rarity: "common",    bit: "said it once. will say it again. has always been right", filename: "07_Check_Your_Work_Guy.png" },
  { id: 8,  name: "Decimal Dave",            rarity: "common",    bit: "showed up after the 4 and ruined everything", filename: "08_Decimal_Dave.png" },
  { id: 9,  name: "Negative Nancy",          rarity: "common",    bit: "took points away from your grade and your self esteem", filename: "09_Negative_Nancy.png" },
  { id: 10, name: "Fraction Fran",           rarity: "common",    bit: "will not simplify. this is a lifestyle choice", filename: "10_Fraction_Fran.png" },
  { id: 11, name: "Zero",                    rarity: "common",    bit: "added nothing to this list", filename: "11_Zero.png" },
  { id: 12, name: "Show Your Work",          rarity: "common",    bit: "the final boss. no weaknesses", filename: "12_Show_Your_Work.png" },
  { id: 13, name: "Algebro",                 rarity: "rare",      bit: "bro is x. we've been looking for him for 8 chapters", filename: "13_Algebro.png" },
  { id: 14, name: "The Word Problem Guy",    rarity: "rare",      bit: "took a train going 60mph to get here and won't stop talking about it", filename: "14_The_Word_Problem_Guy.png" },
  { id: 15, name: "Variable Victor",         rarity: "rare",      bit: "could be anything. chose not to commit", filename: "15_Variable_Victor.png" },
  { id: 16, name: "Absolute Val",            rarity: "rare",      bit: "negative experience. came out positive. life coach now", filename: "16_Absolute_Val.png" },
  { id: 17, name: "Prime Minister",          rarity: "rare",      bit: "cannot be divided. has tried everything", filename: "17_Prime_Minister.png" },
  { id: 18, name: "The Rounding Guy",        rarity: "rare",      bit: "3.7 is 4. this is not up for debate", filename: "18_The_Rounding_Guy.png" },
  { id: 19, name: "Mean Jean",               rarity: "rare",      bit: "she's the average. she knows. she's normal about it. (she's not normal about it)", filename: "19_Mean_Jean.png" },
  { id: 20, name: "Sir Cumference",          rarity: "rare",      bit: "went in circles his whole life. got knighted for it", filename: "20_Sir_Cumference.png" },
  { id: 21, name: "FOIL Lord",               rarity: "epic",      bit: "First Outside Inside Last. has a poster of himself in his locker", filename: "21_FOIL_Lord.png" },
  { id: 22, name: "Pythagoras Bro",          rarity: "epic",      bit: "found out about the shortcut. still processing", filename: "22_Pythagoras_Bro.png" },
  { id: 23, name: "The Denominator",         rarity: "epic",      bit: "on the bottom. holding everything up. zero credit", filename: "23_The_Denominator.png" },
  { id: 24, name: "Pi Guy",                  rarity: "epic",      bit: "you said how many digits. he said yes", filename: "24_Pi_Guy.png" },
  { id: 25, name: "Complex Bro",             rarity: "epic",      bit: "real part is fine. imaginary part has a lot going on", filename: "25_Complex_Bro.png" },
  { id: 26, name: "The Distributive King",   rarity: "epic",      bit: "got into the parentheses. multiplied everything. left", filename: "26_The_Distributive_King.png" },
  { id: 27, name: "Imaginary i",             rarity: "legendary", bit: "technically does not exist. has the best lunch table", filename: "27_Imaginary_i.png" },
  { id: 28, name: "Euler",                   rarity: "legendary", bit: "wrote one equation, put his whole name on it, retired at 30", filename: "28_Euler.png" },
  { id: 29, name: "The Golden Ratio",        rarity: "legendary", bit: "1.618. told you that you were slightly off and walked away", filename: "29_The_Golden_Ratio.png" },
  { id: 30, name: "Infinity",                rarity: "legendary", bit: "asked how much homework you have. this is how much homework you have", filename: "30_Infinity.png" },
];

export const RARITY_LABEL: Record<Rarity, string> = {
  common: "Common", rare: "Rare", epic: "Epic", legendary: "Legendary", mythic: "Mythic",
};

export const RARITY_COLOR: Record<Rarity, string> = {
  common: "#9ca3af", rare: "#3b82f6", epic: "#a855f7", legendary: "#f59e0b", mythic: "#ff1744",
};

const SUPABASE_STORAGE = "https://xftkfdzqfunmqwwbskll.supabase.co/storage/v1/object/public/collectibles";

export function collectibleImageUrl(c: Collectible): string {
  return `${SUPABASE_STORAGE}/${c.filename}`;
}

export function rollCollectible(): Collectible {
  const roll = Math.random() * 100;
  let rarity: Rarity;
  if (roll < 0.5)     rarity = "mythic";
  else if (roll < 2.5)  rarity = "legendary";
  else if (roll < 12.5) rarity = "epic";
  else if (roll < 40.5) rarity = "rare";
  else                rarity = "common";
  const pool = COLLECTIBLES.filter((c) => c.rarity === rarity);
  return pool[Math.floor(Math.random() * pool.length)];
}
