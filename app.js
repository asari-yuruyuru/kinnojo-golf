// 利用者のクラブ距離。コース情報とは分離し、別の利用者向けにも差し替えられます。
const clubData = [
  { id: "driver", name: "Driver", carryYards: 230, totalYards: { min: 240, max: 245 } },
  { id: "3w", name: "3W", carryYards: 210, totalYards: { min: 220, max: 225 } },
  { id: "5w", name: "5W", carryYards: 195, totalYards: { min: 205, max: 210 } },
  { id: "3u", name: "3U", carryYards: 185, totalYards: { min: 195, max: 200 } },
  { id: "4u", name: "4U", carryYards: 175, totalYards: { min: 185, max: 190 } },
];

// 将来の20ラウンド集計で数値・信頼度を差し替える前提の、個人傾向データです。
// 数値は確率ではなく、判定エンジン内で左右傾向を比較するための相対的な重みです。
const playerProfile = {
  leftMissTendency: 2,
  rightMissTendency: 1,
  sampleSize: null,
  confidence: "low",
  recentForm: "unconfirmed",
  clubTendencies: {
    driver: { leftMissTendency: 2, rightMissTendency: 1, confidence: "low" },
  },
};

// 調整はここだけで行います。実測ハザード距離を得た後は、これらを精密判定用の重みに置き換えます。
const personalizedEngineWeights = Object.freeze({
  hazardBySeverity: { none: 0, low: 1, medium: 2, high: 3 },
  escapeCredit: { unknown: 0, small: 0, medium: 3.5, large: 6.5 },
  clubExposure: { driver: 1, "3w": 0.7, "5w": 0.45, "3u": 0.3, "4u": 0.22 },
  distanceBenefit: { driver: 12, "3w": 9, "5w": 4, "3u": 0, "4u": -3 },
  distanceValueMultiplier: { low: 0.7, normal: 1, high: 1.45 },
  confidenceRiskLimit: { low: 8, medium: 12, high: 14 },
  cautionBand: 4,
  hazardPenalty: 4,
  tendencyPenalty: 1.5,
  narrowingPenalty: 5,
  driverStrongSidePenalty: 3,
});

// 当日補正は推奨エンジン本体と分離し、実戦記録を見ながらここだけ調整できます。
const todayAdjustmentCoefficients = Object.freeze({
  windCarry: {
    headwind: { weak: -0.03, medium: -0.06, strong: -0.10 },
    tailwind: { weak: 0.02, medium: 0.04, strong: 0.07 },
  },
  groundRun: { normal: 1, soft: 0.5, hard: 1.5 },
  hazardSafetyMargin: { major: 12, bunker: 5, minor: 5, unknown: 10 },
  oppositeEscapeReduction: { unknown: 0, small: 0, medium: 2, large: 4 },
  sideTendencyMargin: 3,
});

const landingZoneDistances = [175, 185, 195, 210, 230, 245];

// β版のホール全体評価。点数は成功確率ではなく、今後調整する比較用係数。
const wholeHoleWeights = Object.freeze({
  remainingBands: [{ upper: 80, points: -4 }, { upper: 100, points: 12 }, { upper: 130, points: 8 }, { upper: 170, points: 0 }, { upper: 200, points: -16 }, { upper: Infinity, points: -32 }],
  shortHoleDistanceScale: 0.1,
  riskScoreScale: 0.65,
  oneSidedEscapeScale: 0.72,
  twoSidedRiskLimit: 28,
  attackRiskAllowance: 4,
  uphillAttackRiskAllowance: 14,
  shortcutAttackRiskAllowance: 10,
  longApproachThreshold: 170,
  longApproachCostPerYard: 0.4,
  routeRiskAllowance: 5,
  uphillDistanceScale: 1.2,
  verifiedPlayableWidthScale: 0.6,
  blockedSecondShotPenalty: 12,
  layupDistanceLossThreshold: 40,
});

// 利用者が今回確認した実戦上の条件。クラブの正解値や架空の距離は含めない。
const kinnojoRoundExperience = {
  12: { shortLayupBlocksNextShot: true, source: "利用者の実戦評価" },
  13: { landingWidthNotSeverelyNarrow: true, source: "利用者の実戦評価" },
  17: { separateShortcut: true, source: "利用者の実戦評価" },
  18: { sustainedUphill: true, source: "利用者の実戦評価" },
};

function createEmptyLandingZones() {
  return landingZoneDistances.map((distanceFromTee) => ({
    distanceFromTee, fairwayWidth: null, leftSafeMargin: null, rightSafeMargin: null,
    leftHazardType: "unconfirmed", rightHazardType: "unconfirmed", leftHazardDistance: null, rightHazardDistance: null,
    frontHazardType: "unconfirmed", frontHazardDistance: null, requiredCarryToClear: null,
    notes: null, dataSource: null, qualityStatus: "unconfirmed",
  }));
}

function createEmptyMapData() {
  return {
    teeLatitude: null,
    teeLongitude: null,
    greenLatitude: null,
    greenLongitude: null,
    centerLinePoints: null,
    fairwayPolygon: null,
    bunkerPolygons: null,
    waterPolygons: null,
    obAreas: null,
    treeAreas: null,
    dataSource: null,
    dataQuality: "unverified",
    featureStatus: {
      teeCoordinates: "unverified",
      greenCoordinates: "unverified",
      fairwayShape: "unverified",
      bunkerShapes: "unverified",
      waterAreas: "unverified",
      obAreas: "unverified",
      treeAreas: "unverified",
    },
  };
}

function createUnconfirmedHole(holeNumber, par, regularYardage) {
  return {
    holeNumber,
    par,
    regularYardage,
    courseShape: null,
    officialStrategy: null,
    mainRisk: null,
    mainRisks: null,
    tees: { regular: { distanceYards: regularYardage } },
    landingZones: createEmptyLandingZones(),
    recommendation: { club: null, carryYards: null, totalYards: null, safety: null },
    provisionalProfile: null,
    publicStats: { fwKeepRate: null, obRate: null, bunkerRate: null, averageScore: null, difficultyRank: null, dataSource: null, dataPeriod: null },
    leftHazardSeverity: "none",
    rightHazardSeverity: "none",
    leftEscapeRoom: "unknown",
    rightEscapeRoom: "unknown",
    fairwayNarrowsWithDistance: false,
    distanceValue: "normal",
    strategyConfidence: "low",
    mapData: createEmptyMapData(),
    todayAdjustment: { teePosition: null, wind: null, ground: null, hazards: [], memo: null },
  };
}

// ゴルフ場・ホール固有の情報。未確認・未計測の値は推測せず null のまま保持します。
let courseData = {
  id: "kinnojo-out",
  courseName: "鬼ノ城ゴルフ倶楽部",
  tees: [
    { id: "regular", name: "Regular" },
    // 例: { id: "back", name: "Back" },
    // 例: { id: "front", name: "Front" },
  ],
  holes: [
    {
      holeNumber: 1,
      par: 4,
      regularYardage: 344,
      courseShape: "やや右ドッグレッグ・緩やかな打ち下ろし",
      officialStrategy: "ティーショットは左サイドバンカーの右あたりが狙い目です。",
      mainRisks: "正面左サイドのバンカー。右斜面ラフは比較的受けています。",
      tees: { regular: { distanceYards: 344, dataSource: "official" } },
      parDataSource: "official",
      mapData: createEmptyMapData(),
      todayAdjustment: { teePosition: null, wind: null, ground: null, hazards: [], memo: null },
      tacticalBrief: { risks: ["正面左サイドバンカー", "右斜面ラフ"], checks: ["左バンカー手前までの距離", "ティー位置が前か後ろか", "右斜面側がどこまで受けているか"] },
      preRoundStrategy: { primaryClub: "5w", secondaryClub: "3w", avoidClub: "driver", confidence: "medium", mainRisks: ["正面左サイドバンカー", "右斜面ラフ"], checkOnTee: ["左バンカー手前までの距離", "左右どちらが広く見えるか", "ティー位置"], reason: "左バンカー右の狙い目へ運びやすい5Wを基準に、距離が必要なら3Wを検討します。" },
      landingZones: createEmptyLandingZones(),
      recommendation: { club: null, carryYards: null, totalYards: null, safety: null },
      provisionalProfile: { fairwayCharacter: "normal", lateralRisk: "moderate", longClubCaution: false, preferredClubIds: ["3w", "5w"] },
      publicStats: { fwKeepRate: 55, obRate: 24, bunkerRate: 40, averageScore: 5.49, difficultyRank: 10, dataSource: "GDOスコア", dataPeriod: "2025年8月〜2026年7月" },
      leftHazardSeverity: "high", rightHazardSeverity: "none", leftEscapeRoom: "small", rightEscapeRoom: "large", fairwayNarrowsWithDistance: false, distanceValue: "normal", strategyConfidence: "low",
      fieldValidation: { primaryClub: "5w", secondaryClub: "3w" },
      dataVerification: {
        sourceUrl: "https://kinojo.jp/course/no1/",
        items: [
          { label: "ティー位置（座標・実測位置）", status: "unavailable", value: null, dataSource: null },
          { label: "グリーン位置（座標・実測位置）", status: "unavailable", value: null, dataSource: null },
          { label: "フェアウェイ形状", status: "confirmed", value: "やや右ドッグレッグ・緩やかな打ち下ろし", dataSource: "official" },
          { label: "バンカー位置", status: "confirmed", value: "ティーショットに係わるハザードは正面左サイドバンカー", dataSource: "official" },
          { label: "OBの方向", status: "unavailable", value: null, dataSource: null },
          { label: "池・クリークの有無", status: "unavailable", value: null, dataSource: null },
          { label: "175〜245yd地点のフェアウェイ幅", status: "unavailable", value: null, dataSource: null },
          { label: "175〜245yd地点の左右ハザードまでの余裕", status: "unavailable", value: null, dataSource: null },
          { label: "バンカー手前・奥までの距離", status: "unavailable", value: null, dataSource: null },
          { label: "ハザード越えに必要なキャリー", status: "unavailable", value: null, dataSource: null },
        ],
      },
    },
    {
      ...createUnconfirmedHole(2, 3, 196),
      courseShape: "距離のあるPAR3",
      officialStrategy: "左サイドからの攻略が安全です。",
      mainRisks: "グリーン右手前約30yd付近の深いバンカーと、グリーン右横のバンカー。",
      publicStats: { fwKeepRate: 0, obRate: 27, bunkerRate: 23, averageScore: 4.25, difficultyRank: 16, dataSource: "GDOスコア", dataPeriod: "2025年8月〜2026年7月" },
    },
    {
      ...createUnconfirmedHole(3, 5, 518),
      courseShape: "左ドッグレッグ・約30mの打ち下ろし",
      officialStrategy: "ティーショットはバンカー右狙いが安全です。飛距離によって狙う方向を変え、レイアップ時はバンカー群右のフラットな場所を狙います。",
      mainRisks: "セカンドショットでは右へのミスに注意が必要です。",
      provisionalProfile: { fairwayCharacter: "normal", lateralRisk: "moderate", longClubCaution: true, preferredClubIds: ["5w", "3u"] },
      publicStats: { fwKeepRate: 54, obRate: 39, bunkerRate: 39, averageScore: 6.61, difficultyRank: 9, dataSource: "GDOスコア", dataPeriod: "2025年8月〜2026年7月" },
      leftHazardSeverity: "medium", rightHazardSeverity: "low", leftEscapeRoom: "small", rightEscapeRoom: "large", fairwayNarrowsWithDistance: true, distanceValue: "high", strategyConfidence: "low",
      fieldValidation: { primaryClub: "5w", secondaryClub: "3w" },
      tacticalBrief: { risks: ["ティーショット狙い目付近のバンカー", "飛距離で狙う方向が変わる"], checks: ["バンカー右までの距離", "飛距離に応じた狙い方向", "レイアップ地点までの距離"] },
      preRoundStrategy: { primaryClub: "5w", secondaryClub: "3u", avoidClub: "driver", confidence: "low", mainRisks: ["ティーショット狙い目付近のバンカー", "飛距離で狙う方向が変わる", "右へのミス"], checkOnTee: ["バンカー右までの距離", "飛距離に応じた狙い方向", "レイアップ地点までの距離"], reason: "PAR5の次打距離も残しつつ、狙い方向が変わる長いクラブは避け、5Wを基準にします。" },
    },
    {
      ...createUnconfirmedHole(4, 3, 127),
      courseShape: "約6mの打ち下ろし",
      officialStrategy: "風を考慮した距離感が重要です。",
      mainRisks: "グリーン左右をガードバンカーが囲みます。",
      publicStats: { fwKeepRate: 0, obRate: 17, bunkerRate: 41, averageScore: 4.04, difficultyRank: 17, dataSource: "GDOスコア", dataPeriod: "2025年8月〜2026年7月" },
    },
    {
      ...createUnconfirmedHole(5, 4, 381),
      courseShape: "緩やかな打ち上げ・右サイドが狭い",
      officialStrategy: "ティーショットは左サイドのバンカー右が狙い目です。左サイドから攻める方が安全です。",
      mainRisks: "右に大きく曲げると急斜面や他ホール方向に行きやすくなります。",
      provisionalProfile: { fairwayCharacter: "normal", lateralRisk: "high", longClubCaution: false, preferredClubIds: ["3w", "5w"] },
      publicStats: { fwKeepRate: 49, obRate: 18, bunkerRate: 37, averageScore: 5.71, difficultyRank: 5, dataSource: "GDOスコア", dataPeriod: "2025年8月〜2026年7月" },
      leftHazardSeverity: "none", rightHazardSeverity: "high", leftEscapeRoom: "large", rightEscapeRoom: "small", fairwayNarrowsWithDistance: false, distanceValue: "high", strategyConfidence: "medium",
      fieldValidation: { primaryClub: "driver", secondaryClub: "3w" },
      tacticalBrief: { risks: ["右サイドの狭さ", "右の急斜面・他ホール方向"], checks: ["左バンカー手前までの距離", "右方向の余裕", "ティー位置が前か後ろか"] },
      preRoundStrategy: { primaryClub: "5w", secondaryClub: "3w", avoidClub: "driver", confidence: "medium", mainRisks: ["右サイドの狭さ", "右の急斜面・他ホール方向"], checkOnTee: ["左バンカー手前までの距離", "右方向の余裕", "ティー位置"], reason: "右の大きなミスを避け、左サイドから攻めやすい5Wを基準にします。" },
    },
    {
      ...createUnconfirmedHole(6, 4, 367),
      courseShape: "真っすぐ・約20mの打ち下ろし・フェアウェイは広い",
      officialStrategy: "左右は緩やかに受けているため、ティーショットはセンター狙い。大きなリスクを取りにいく必要はありません。",
      mainRisks: "セカンドショットではグリーンオーバーと、左カート道方向のOBに注意が必要です。",
      provisionalProfile: { fairwayCharacter: "wide", lateralRisk: "low", longClubCaution: false, preferredClubIds: ["driver", "3w"] },
      publicStats: { fwKeepRate: 55, obRate: 17, bunkerRate: 31, averageScore: 5.31, difficultyRank: 14, dataSource: "GDOスコア", dataPeriod: "2025年8月〜2026年7月" },
      leftHazardSeverity: "low", rightHazardSeverity: "low", leftEscapeRoom: "large", rightEscapeRoom: "large", fairwayNarrowsWithDistance: false, distanceValue: "high", strategyConfidence: "medium",
      fieldValidation: { primaryClub: "driver", secondaryClub: "3w" },
      tacticalBrief: { risks: ["大きなティーショットリスクは公式情報で未確認"], checks: ["フェアウェイ中央までの距離", "ティー位置が前か後ろか", "左右どちらが広く見えるか"] },
      preRoundStrategy: { primaryClub: "driver", secondaryClub: "3w", avoidClub: "4u", confidence: "medium", mainRisks: ["大きなティーショットリスクは公式情報で未確認"], checkOnTee: ["フェアウェイ中央までの距離", "ティー位置", "左右どちらが広く見えるか"], reason: "広いフェアウェイとセンター狙いを踏まえ、必要以上に短く刻まずDriverを候補に残します。" },
    },
    {
      ...createUnconfirmedHole(7, 4, 326),
      courseShape: "約11mの打ち上げ",
      officialStrategy: "ティーショットは右バンカーの左あたりが狙い目です。風向きと飛距離を把握して打ちます。",
      mainRisks: "左サイドはOBが近く、左バンカーを避けすぎると右バンカーにつかまる可能性があります。",
      provisionalProfile: { fairwayCharacter: "normal", lateralRisk: "high", longClubCaution: false, preferredClubIds: ["5w", "3u"] },
      publicStats: { fwKeepRate: 53, obRate: 23, bunkerRate: 52, averageScore: 5.63, difficultyRank: 7, dataSource: "GDOスコア", dataPeriod: "2025年8月〜2026年7月" },
      leftHazardSeverity: "high", rightHazardSeverity: "none", leftEscapeRoom: "small", rightEscapeRoom: "medium", fairwayNarrowsWithDistance: false, distanceValue: "high", strategyConfidence: "medium",
      fieldValidation: { primaryClub: "3w", secondaryClub: "5w" },
      tacticalBrief: { risks: ["左サイドのOB", "左右のバンカー"], checks: ["右バンカー左までの距離", "左OB方向の距離", "風向きとティー位置"] },
      preRoundStrategy: { primaryClub: "5w", secondaryClub: "3u", avoidClub: "driver", confidence: "medium", mainRisks: ["左サイドのOB", "左右のバンカー"], checkOnTee: ["右バンカー左までの距離", "左OB方向の距離", "風向きとティー位置"], reason: "距離が短いため、左OBと左右バンカーを避けやすい5Wを基準にします。" },
    },
    {
      ...createUnconfirmedHole(8, 4, 341),
      courseShape: "谷越え・左右は受けているがフェアウェイは先細り",
      officialStrategy: "右サイドバンカー横のフェアウェイ中央〜やや左が狙い目です。距離を出しすぎず、安全な着弾地点を優先します。",
      mainRisks: "ロングヒッターほどリスクが高く、右方向では次打で林がスタイミーになりやすい。左ラフのマウンドを越えるとOBです。",
      provisionalProfile: { fairwayCharacter: "narrowing", lateralRisk: "high", longClubCaution: true, preferredClubIds: ["5w", "3u"] },
      publicStats: { fwKeepRate: 48, obRate: 24, bunkerRate: 39, averageScore: 5.61, difficultyRank: 8, dataSource: "GDOスコア", dataPeriod: "2025年8月〜2026年7月" },
      leftHazardSeverity: "high", rightHazardSeverity: "none", leftEscapeRoom: "small", rightEscapeRoom: "large", fairwayNarrowsWithDistance: true, distanceValue: "high", strategyConfidence: "medium",
      fieldValidation: { primaryClub: "3w", secondaryClub: "5w" },
      tacticalBrief: { risks: ["フェアウェイの先細り", "左ラフ奥のOB", "右方向の林"], checks: ["フェアウェイが狭くなる地点", "右バンカー横までの距離", "左ラフのマウンドまでの距離"] },
      preRoundStrategy: { primaryClub: "3u", secondaryClub: "4u", avoidClub: "driver", confidence: "low", mainRisks: ["フェアウェイの先細り", "左ラフ奥のOB", "右方向の林"], checkOnTee: ["フェアウェイが狭くなる地点", "右バンカー横までの距離", "左ラフのマウンドまでの距離"], reason: "距離を出しすぎるリスクを抑え、先細り前の安全な着弾を優先します。" },
    },
    {
      ...createUnconfirmedHole(9, 5, 504),
      courseShape: "約27mの打ち上げ・右サイドにクリークが続く",
      officialStrategy: "グリーン後方の大きなケヤキ方向を目安に、ティーショット、セカンドとも中央〜やや右寄りを基本にします。",
      mainRisks: "右サイドはティーからグリーン横までクリークが続き、左に行きすぎると林が影響して次打でクリークが視界に入りやすくなります。",
      provisionalProfile: { fairwayCharacter: "normal", lateralRisk: "high", longClubCaution: false, preferredClubIds: ["3w", "5w"] },
      publicStats: { fwKeepRate: 61, obRate: 25, bunkerRate: 32, averageScore: 6.90, difficultyRank: 2, dataSource: "GDOスコア", dataPeriod: "2025年8月〜2026年7月" },
      leftHazardSeverity: "none", rightHazardSeverity: "high", leftEscapeRoom: "large", rightEscapeRoom: "small", fairwayNarrowsWithDistance: false, distanceValue: "high", strategyConfidence: "low",
      fieldValidation: { primaryClub: "driver", secondaryClub: "3w" },
      tacticalBrief: { risks: ["右サイドに続くクリーク", "左に行きすぎた際の林"], checks: ["右クリークまでの距離", "中央〜やや右の着弾地点", "ティー位置と風向き"] },
      preRoundStrategy: { primaryClub: "5w", secondaryClub: "3w", avoidClub: "driver", confidence: "low", mainRisks: ["右サイドに続くクリーク", "左に行きすぎた際の林"], checkOnTee: ["右クリークまでの距離", "中央〜やや右の着弾地点", "ティー位置と風向き"], reason: "PAR5の次打距離も考慮しつつ、右クリークへ近づきすぎない5Wを基準にします。" },
    },
    {
      ...createUnconfirmedHole(10, 4, 363),
      courseShape: "大きな右ドッグレッグ・約13mの打ち下ろし",
      officialStrategy: "右バンカーの左を狙い、フェアウェイキープを優先します。",
      mainRisk: "右方向のショートカットと、ロングヒッターが届く可能性のある左手前バンカー。",
      mainRisks: "右方向のショートカットは難しい左足下がりになり、ロングヒッターは左手前バンカーにも注意が必要です。",
      provisionalProfile: { fairwayCharacter: "normal", lateralRisk: "moderate", longClubCaution: true, preferredClubIds: ["3w", "5w"] },
      leftHazardSeverity: "medium", rightHazardSeverity: "low", leftEscapeRoom: "unknown", rightEscapeRoom: "medium", fairwayNarrowsWithDistance: false, distanceValue: "normal", strategyConfidence: "medium",
      tacticalBrief: { risks: ["右方向のショートカット", "左手前バンカー"], checks: ["右バンカー左までの距離", "左手前バンカーまでの距離", "左右の受け方"] },
    },
    {
      ...createUnconfirmedHole(11, 3, 122),
      courseShape: "約10mの打ち下ろし",
      officialStrategy: "風とピン位置を確認し、グリーン中央を基準に距離を合わせます。",
      mainRisk: "左サイドと奥のOB、ショート・左右のバンカー。",
      mainRisks: "左サイドとグリーン奥のOB、ショートおよび左右のバンカーに注意が必要です。",
    },
    {
      ...createUnconfirmedHole(12, 5, 516),
      courseShape: "左サイドに池が広がるPAR5",
      officialStrategy: "刻む場合は右バンカーの左側を狙い、安易な右林越えのショートカットは避けます。",
      mainRisk: "左の池、右林越えのOB、バンカー。",
      mainRisks: "左の池と、右林越えを狙った際のOB、ティーショットのバンカーに注意が必要です。",
      provisionalProfile: { fairwayCharacter: "normal", lateralRisk: "high", longClubCaution: true, preferredClubIds: ["5w", "3w"] },
      leftHazardSeverity: "high", rightHazardSeverity: "high", leftEscapeRoom: "small", rightEscapeRoom: "small", fairwayNarrowsWithDistance: false, distanceValue: "high", strategyConfidence: "medium",
      tacticalBrief: { risks: ["左サイドの池", "右林越えのOB", "バンカー"], checks: ["左池までの距離", "右バンカー左までの距離", "右林を避ける狙い幅"] },
    },
    {
      ...createUnconfirmedHole(13, 4, 413),
      courseShape: "真っすぐ・距離のある打ち下ろし",
      officialStrategy: "フェアウェイ中央やや右を狙い、左右への大きなミスを避けます。",
      mainRisk: "左右のOBと、左右の林に入った場合の次打。",
      mainRisks: "左右のOBに注意。右の林、左の裸地や林へ外すと次打が難しくなります。",
      provisionalProfile: { fairwayCharacter: "normal", lateralRisk: "high", longClubCaution: false, preferredClubIds: ["3w", "driver"] },
      leftHazardSeverity: "high", rightHazardSeverity: "high", leftEscapeRoom: "small", rightEscapeRoom: "small", fairwayNarrowsWithDistance: false, distanceValue: "high", strategyConfidence: "medium",
      tacticalBrief: { risks: ["左右のOB", "左右の林"], checks: ["左右OBまでの余裕", "フェアウェイ中央やや右の幅", "ティー位置と風向き"] },
    },
    {
      ...createUnconfirmedHole(14, 4, 278),
      courseShape: "距離の短いPAR4",
      officialStrategy: "Driverにこだわらず、フェアウェイ中央へ正確に運べるクラブを選びます。",
      mainRisk: "左OBと、右斜面ラフの先にある池。",
      mainRisks: "左はOB、右は斜面ラフの先に池があるため、センターキープが重要です。",
      provisionalProfile: { fairwayCharacter: "normal", lateralRisk: "high", longClubCaution: true, preferredClubIds: ["5w", "3u"] },
      leftHazardSeverity: "high", rightHazardSeverity: "high", leftEscapeRoom: "small", rightEscapeRoom: "small", fairwayNarrowsWithDistance: false, distanceValue: "low", strategyConfidence: "medium",
      tacticalBrief: { risks: ["左OB", "右斜面ラフ先の池"], checks: ["左OBまでの余裕", "右の池までの距離", "センターの安全な着弾幅"] },
    },
    {
      ...createUnconfirmedHole(15, 3, 131),
      courseShape: "池越えのPAR3",
      officialStrategy: "池を確実に越え、左の深いバンカーを避けてグリーン中央を狙います。",
      mainRisk: "手前の池と左の深いバンカー。",
      mainRisks: "池越えが必要で、左には深いバンカーがあります。右ラフ側の方が比較的安全です。",
    },
    {
      ...createUnconfirmedHole(16, 5, 457),
      courseShape: "緩やかな左ドッグレッグ・約19mの打ち上げ",
      officialStrategy: "正面バンカーを越せる飛距離を確認し、越えない場合はバンカー右を狙います。",
      mainRisk: "左カート道付近のOBと正面バンカー。",
      mainRisks: "左カート道側はOBが近く、正面バンカーの越え方は飛距離に応じて判断が必要です。右側は比較的受けています。",
      provisionalProfile: { fairwayCharacter: "normal", lateralRisk: "high", longClubCaution: false, preferredClubIds: ["driver", "3w"] },
      leftHazardSeverity: "high", rightHazardSeverity: "low", leftEscapeRoom: "small", rightEscapeRoom: "large", fairwayNarrowsWithDistance: false, distanceValue: "high", strategyConfidence: "medium",
      tacticalBrief: { risks: ["左カート道付近のOB", "正面バンカー"], checks: ["正面バンカー越えの必要Carry", "左OBまでの余裕", "右側の受け方"] },
    },
    {
      ...createUnconfirmedHole(17, 4, 335),
      courseShape: "谷越え・左ドッグレッグ・約14mの打ち下ろし",
      officialStrategy: "風と飛距離を確認し、赤松林の左右どちらを通すか決めます。左のショートカットは慎重に判断します。",
      mainRisk: "赤松林と、左ショートカットで越える必要がある3つのバンカー。",
      mainRisks: "赤松林でルートが分かれ、左のショートカットは3つのバンカー越えになります。",
      provisionalProfile: { fairwayCharacter: "normal", lateralRisk: "high", longClubCaution: true, preferredClubIds: ["5w", "3w"] },
      leftHazardSeverity: "medium", rightHazardSeverity: "medium", leftEscapeRoom: "unknown", rightEscapeRoom: "unknown", fairwayNarrowsWithDistance: false, distanceValue: "normal", strategyConfidence: "low",
      tacticalBrief: { risks: ["赤松林", "左ルートの3バンカー"], checks: ["左右ルートの安全幅", "左バンカー越えの必要Carry", "風向きとティー位置"] },
    },
    {
      ...createUnconfirmedHole(18, 4, 367),
      courseShape: "緩やかな打ち上げ",
      officialStrategy: "フェアウェイキープを優先しつつ、次打のために可能な範囲で距離を確保します。",
      mainRisk: "左サイドに続くクリークと右の林・OB。",
      mainRisks: "左はティーからグリーン横までクリークが続き、右の林方向はOBになりやすいため左右の大きなミスに注意が必要です。",
      provisionalProfile: { fairwayCharacter: "normal", lateralRisk: "high", longClubCaution: false, preferredClubIds: ["3w", "driver"] },
      leftHazardSeverity: "high", rightHazardSeverity: "high", leftEscapeRoom: "small", rightEscapeRoom: "small", fairwayNarrowsWithDistance: false, distanceValue: "high", strategyConfidence: "medium",
      tacticalBrief: { risks: ["左サイドのクリーク", "右の林・OB"], checks: ["左クリークまでの距離", "右OBまでの余裕", "中央の安全な着弾幅"] },
    },
  ],
};

// 公開コース情報とクラブ候補は別に保持します。距離未確認のハザードは推測しません。
const sugiyamaSources = {
  yardage: "https://booking.gora.golf.rakuten.co.jp/guide/course_info/disp/c_id/250019",
  west: "https://greenon.jp/course_detail/show_course.php?course=25022&type=all",
  north: "https://greenon.jp/course_detail/show_course.php?course=25020&type=all",
};

function createSugiyamaHole(number, par, backYardage, regularYardage, preview, candidate = null) {
  const section = number <= 9 ? "west" : "north";
  const hole = createUnconfirmedHole(number, par, regularYardage);
  return {
    ...hole,
    backYardage,
    tees: {
      back: { distanceYards: backYardage, dataSource: "楽天GORA" },
      regular: { distanceYards: regularYardage, dataSource: "楽天GORA" },
    },
    parDataSource: "楽天GORA",
    courseShape: preview.shape,
    mainRisk: preview.teeRisk,
    // GreenOnの攻略文は第三者情報。公式攻略欄とは混同しません。
    officialStrategy: null,
    leftHazardSeverity: null,
    rightHazardSeverity: null,
    fairwayNarrowsWithDistance: null,
    coursePreview: {
      ...preview,
      confidence: candidate ? "B" : "C",
      sourceName: "GreenOn（第三者のコース案内）",
      sourceUrl: sugiyamaSources[section],
    },
    preRoundStrategyCandidate: candidate,
    section,
    sectionHoleNumber: number <= 9 ? number : number - 9,
  };
}

const sugiyamaCourseData = {
  id: "shigaraki-sugiyama-west-north",
  courseName: "信楽カントリー倶楽部 杉山コース（西→北）",
  yardageSourceUrl: sugiyamaSources.yardage,
  tees: [{ id: "back", name: "Back" }, { id: "regular", name: "Regular" }],
  holes: [
    createSugiyamaHole(1, 5, 481, 481, { shape: "ほぼ直線", aim: "右バンカーの左", teeRisk: "右バンカー。手前・奥までの距離は未取得", nextShot: null }, { primaryClub: "driver", aggressiveClub: null, reason: "PAR5の距離価値を考慮。右バンカーの左を狙う暫定候補" }),
    createSugiyamaHole(2, 3, 160, 123, { shape: "打ち下ろし", aim: null, teeRisk: null, nextShot: "打ち下ろしを考慮した番手選択" }),
    createSugiyamaHole(3, 4, 352, 341, { shape: "フェアウェイが左へ傾斜", aim: null, teeRisk: "左傾斜。左右の逃げ場は未取得", nextShot: null }, { primaryClub: "3w", aggressiveClub: "driver", reason: "左傾斜とDriverの左ミス傾向を考慮。着弾幅は現地確認" }),
    createSugiyamaHole(4, 4, 371, 351, { shape: null, aim: "左の山裾", teeRisk: null, nextShot: "セカンドショットは池に注意" }, { primaryClub: "driver", aggressiveClub: null, reason: "ティーは左山裾を狙い、池はセカンドの注意点。距離を残しすぎない暫定候補" }),
    createSugiyamaHole(5, 4, 367, 344, { shape: "ティーショットは打ち上げ", aim: null, teeRisk: null, nextShot: null }, { primaryClub: "driver", aggressiveClub: null, reason: "打ち上げのPAR4で次打距離を考慮。着弾帯は現地確認" }),
    createSugiyamaHole(6, 4, 359, 359, { shape: "ティーショット着弾帯がブラインド", aim: "やや左からの攻略情報あり", teeRisk: "先のフェアウェイ幅・左右の危険は未取得", nextShot: null }),
    createSugiyamaHole(7, 5, 447, 447, { shape: null, aim: "バンカーの右", teeRisk: "バンカーまでの距離・左右の余裕は未取得", nextShot: null }),
    createSugiyamaHole(8, 3, 143, 143, { shape: null, aim: null, teeRisk: "距離と方向の精度が重要", nextShot: null }),
    createSugiyamaHole(9, 4, 395, 395, { shape: null, aim: "右バンカー方向", teeRisk: "右の林は次打を妨げる可能性", nextShot: "右林が次打の障害になり得る" }),
    createSugiyamaHole(10, 5, 466, 450, { shape: null, aim: "右バンカーの左", teeRisk: "右バンカーまでの距離は未取得", nextShot: null }, { primaryClub: "driver", aggressiveClub: null, reason: "PAR5の距離価値を考慮。右バンカー左の狙い目を現地確認" }),
    createSugiyamaHole(11, 4, 368, 349, { shape: null, aim: "左クロスバンカー越えが好ルート", teeRisk: "左クロスバンカー。越えるためのCarryは未取得", nextShot: null }),
    createSugiyamaHole(12, 3, 173, 144, { shape: null, aim: "グリーン左側", teeRisk: null, nextShot: "左側からの攻略が比較的安全という案内" }),
    createSugiyamaHole(13, 4, 421, 421, { shape: null, aim: "左カート道方向", teeRisk: "カート道周辺のOB・余裕は未取得", nextShot: null }),
    createSugiyamaHole(14, 3, 186, 144, { shape: null, aim: null, teeRisk: "右の池", nextShot: "左右奥のバンカーに注意（位置関係は現地確認）" }),
    createSugiyamaHole(15, 4, 368, 342, { shape: null, aim: "右の山裾", teeRisk: null, nextShot: "セカンドショットは打ち上げ" }, { primaryClub: "driver", aggressiveClub: null, reason: "右山裾を狙い、打ち上げの次打距離を抑える暫定候補" }),
    createSugiyamaHole(16, 5, 497, 458, { shape: null, aim: "左バンカー越えが好ルート", teeRisk: "左バンカー越えの必要Carryは未取得", nextShot: null }),
    createSugiyamaHole(17, 4, 406, 374, { shape: null, aim: "フェアウェイ中央", teeRisk: "着弾帯の幅・左右の危険は未取得", nextShot: null }, { primaryClub: "driver", aggressiveClub: null, reason: "長めのPAR4。センター狙いと次打距離を考慮した暫定候補" }),
    createSugiyamaHole(18, 4, 385, 350, { shape: null, aim: "右の山裾", teeRisk: "左右の逃げ場・着弾帯は未取得", nextShot: null }),
  ],
};

// コースを追加するときは、この配列へ同じ構造のコースを登録します。
// 既存の鬼ノ城IDはlocalStorageとの互換性のため変更しません。
const courseCatalog = [courseData, sugiyamaCourseData];
const roundExperienceByCourse = { "kinnojo-out": kinnojoRoundExperience };
const selected = { courseId: courseData.id, hole: 1, tee: "regular", course: "out" };
let editMode = false;
let mapImportPreview = null;
let mapImportError = null;
let osmGeoJsonResult = null;
let osmGeoJsonError = null;
let osmGeoJsonText = "";
let todayEditMode = false;
let backupImportMessage = null;
let backupImportStatus = null;
const v4State = { ready: false, activeRound: null, rounds: [], error: null, migrationMessage: null };
const V4_ACTIVE_ROUND_KEY = "activeRoundId";
const REPORT_AUTOSAVE_DELAY_MS = 800;
const reportSaveTimers = new Map();
const pendingReportSaves = new Map();
const reportEditVersions = new Map();
let reportSaveQueue = Promise.resolve();
const reportDefinitions = Object.freeze({
  tee: { label: "Tショット報告", guide: "クラブ｜狙い｜避けたい場所｜風｜打つ前に考えたこと｜結果・球筋｜原因・気づき", promptId: "golf-report-tee", sequence: 1 },
  second: { label: "セカンド報告", guide: "残り距離｜ライ・傾斜｜風｜クラブ｜狙い｜避けたい場所｜打つ前に考えたこと｜結果・球筋｜原因・気づき", promptId: "golf-report-second", sequence: 2 },
  third: { label: "サード報告", guide: "残り距離｜ライ・傾斜｜風｜クラブ｜狙い｜避けたい場所｜打つ前に考えたこと｜結果・球筋｜原因・気づき", promptId: "golf-report-third", sequence: 3 },
  holeOut: { label: "ホールアウト報告", guide: "アプローチ：距離｜ライ｜クラブ｜結果・気づき\nパター：1stパット距離｜傾斜｜結果・感覚\n最後に：ホール全体の反省・気づき", promptId: "golf-report-hole-out", sequence: 4 },
});
// 画面上の入力内容が明示保存済みかを示す一時状態です。保存データの形式は変えません。
const dirtyRecordHoles = new Set();
const storageKeyFor = (course) => `golf-tee-strategy:${course.id}:landing-zones`;
const coursePicker = document.querySelector("#coursePicker");
const courseSelector = document.querySelector("#courseSelector");
const holeSelector = document.querySelector("#holeSelector");
const teeSelector = document.querySelector("#teeSelector");
const strategyCard = document.querySelector("#strategyCard");
const playSurface = document.querySelector("#playSurface");
const verificationScreen = document.querySelector("#verificationScreen");
const developerScreen = document.querySelector("#developerScreen");
const bottomNav = document.querySelector(".bottom-nav");
const v4RoundStatus = document.querySelector("#v4RoundStatus");

function v4SectionForHole(course, hole) {
  if (course.id === sugiyamaCourseData.id) {
    return { sectionId: hole.holeNumber <= 9 ? "west" : "north", sectionName: hole.holeNumber <= 9 ? "西" : "北", sectionHoleNumber: hole.sectionHoleNumber ?? (hole.holeNumber <= 9 ? hole.holeNumber : hole.holeNumber - 9) };
  }
  return { sectionId: hole.holeNumber <= 9 ? "out" : "in", sectionName: hole.holeNumber <= 9 ? "OUT" : "IN", sectionHoleNumber: hole.holeNumber <= 9 ? hole.holeNumber : hole.holeNumber - 9 };
}

function v4RoutingForCourse(course) {
  const sugiyama = course.id === sugiyamaCourseData.id;
  const sections = sugiyama ? [["west", "西"], ["north", "北"]] : [["out", "OUT"], ["in", "IN"]];
  return {
    label: sections.map(([, name]) => name).join("→"),
    legs: sections.map(([sectionId, sectionNameSnapshot], index) => ({ legId: `leg-${index + 1}`, order: index + 1, sectionId, sectionNameSnapshot, occurrence: 1 })),
  };
}

function v4CourseDefinition(course) {
  const now = new Date().toISOString();
  const sectionMap = new Map();
  course.holes.forEach((hole) => {
    const section = v4SectionForHole(course, hole);
    if (!sectionMap.has(section.sectionId)) sectionMap.set(section.sectionId, { sectionId: section.sectionId, sectionName: section.sectionName, holes: [] });
    sectionMap.get(section.sectionId).holes.push({
      holeId: `${section.sectionId}-${section.sectionHoleNumber}`,
      holeNumber: section.sectionHoleNumber,
      legacyHoleNumber: hole.holeNumber,
      par: hole.par,
      tees: course.tees.map((tee) => ({ teeId: tee.id, teeName: tee.name, distanceYards: hole.tees?.[tee.id]?.distanceYards ?? null })),
      courseShape: hole.courseShape ?? null,
      officialStrategy: hole.officialStrategy ?? null,
      mainRisk: hole.mainRisk ?? hole.mainRisks ?? null,
      tacticalBrief: hole.tacticalBrief ?? null,
      preRoundStrategyCandidate: hole.preRoundStrategyCandidate ?? null,
    });
  });
  return { schemaVersion: 4, courseId: course.id, courseName: course.courseName, definitionVersion: 1, origin: "builtIn", sections: [...sectionMap.values()], createdAt: now, updatedAt: now };
}

function v4StrategySnapshot(hole, legacyRecord = null) {
  if (legacyRecord) return {
    primaryClubId: legacyRecord.preRoundPrimaryClub ?? null,
    secondaryClubId: legacyRecord.preRoundSecondaryClub ?? null,
    aggressiveClubId: legacyRecord.preRoundAggressiveClub ?? null,
    mainRisks: hole.mainRisks ?? hole.mainRisk ?? null,
    source: "v3RoundRecord",
  };
  const strategy = recommendationForPlay(hole);
  return {
    primaryClubId: strategy?.primaryRecommendation?.club?.id ?? strategy?.primary?.club?.id ?? null,
    secondaryClubId: strategy?.secondary?.club?.id ?? null,
    aggressiveClubId: strategy?.aggressiveOption?.club?.id ?? null,
    mainRisks: hole.mainRisks ?? hole.mainRisk ?? null,
    reasons: strategy?.primaryRecommendation?.reasons ?? strategy?.primary?.reasons ?? [],
    source: "courseDefinition",
  };
}

function createV4HoleLog(course, hole, teeId, playOrder, legId, legacyRecord = null, migrationTime = null) {
  const now = migrationTime ?? new Date().toISOString();
  const section = v4SectionForHole(course, hole);
  const tee = course.tees.find((item) => item.id === teeId) ?? null;
  const reports = [];
  [["memo", legacyRecord?.memo], ["resultMemo", legacyRecord?.resultMemo]].forEach(([sourceField, text], index) => {
    if (typeof text !== "string" || !text.length) return;
    reports.push({ reportId: `legacy-${hole.holeNumber}-${sourceField}`, type: "legacyNote", sequence: index + 1, text, promptId: null, promptVersion: null, recordedAt: legacyRecord.recordedAt ?? null, updatedAt: legacyRecord.recordedAt ?? null, migrationSourceField: sourceField });
  });
  const structuredResult = legacyRecord ? {
    actualClubId: legacyRecord.actualClubId ?? null,
    actualClubName: legacyRecord.actualClubName ?? null,
    otherClubName: legacyRecord.otherClubName ?? null,
    shotResult: legacyRecord.shotResult ?? null,
    firstPuttDistance: legacyRecord.firstPuttDistance ?? null,
    recordedAt: legacyRecord.recordedAt ?? null,
  } : {};
  return {
    roundHoleId: `${legId ?? "legacy"}-${section.sectionId}-${section.sectionHoleNumber}`,
    playOrder,
    legId,
    courseHoleRef: { courseId: course.id, sectionId: section.sectionId, holeId: `${section.sectionId}-${section.sectionHoleNumber}`, holeNumber: section.sectionHoleNumber, legacyHoleNumber: hole.holeNumber },
    holeSnapshot: { sectionName: section.sectionName, par: hole.par, teeId: tee?.id ?? null, teeName: tee?.name ?? null, distanceYards: tee ? hole.tees?.[tee.id]?.distanceYards ?? null : legacyRecord?.distanceYards ?? null },
    strategySnapshot: v4StrategySnapshot(hole, legacyRecord),
    structuredResult,
    reports,
    legacyV3: legacyRecord ? { originalRoundRecord: structuredClone(legacyRecord) } : null,
    createdAt: now,
    updatedAt: now,
  };
}

function createV4RoundSession(course = courseData) {
  const now = new Date();
  const createdAt = now.toISOString();
  const playDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  const datePart = playDate.replaceAll("-", "");
  const unique = crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const routing = v4RoutingForCourse(course);
  const holesBySection = new Map(routing.legs.map((leg) => [leg.sectionId, []]));
  course.holes.forEach((hole) => holesBySection.get(v4SectionForHole(course, hole).sectionId)?.push(hole));
  let playOrder = 0;
  const holeLogs = routing.legs.flatMap((leg) => holesBySection.get(leg.sectionId).map((hole) => createV4HoleLog(course, hole, selected.tee, ++playOrder, leg.legId)));
  return {
    schemaVersion: 4,
    roundId: `round_${datePart}_${unique}`,
    playDate,
    courseId: course.id,
    courseNameSnapshot: course.courseName,
    courseDefinitionVersion: 1,
    teeSelection: { teeId: selected.tee, teeName: course.tees.find((tee) => tee.id === selected.tee)?.name ?? null },
    routing,
    status: "inProgress",
    startedAt: createdAt,
    endedAt: null,
    roundMemo: null,
    holeLogs,
    createdAt,
    updatedAt: createdAt,
    migration: null,
  };
}

function simpleV4Fingerprint(value) {
  const text = JSON.stringify(value);
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function createMigratedV4Round(course, records, fingerprint) {
  const migratedAt = new Date().toISOString();
  const isSugiyama = course.id === sugiyamaCourseData.id;
  const routing = isSugiyama ? v4RoutingForCourse(course) : { label: null, legs: [] };
  const legBySection = new Map(routing.legs.map((leg) => [leg.sectionId, leg.legId]));
  const holeLogs = records.map(({ hole, record }) => {
    const section = v4SectionForHole(course, hole);
    return createV4HoleLog(course, hole, null, isSugiyama ? hole.holeNumber : null, legBySection.get(section.sectionId) ?? null, record, migratedAt);
  });
  const recordedDates = records.map(({ record }) => record.recordedAt).filter(Boolean).sort();
  return {
    schemaVersion: 4,
    roundId: `migrated_v3_${course.id.replace(/[^a-z0-9-]/gi, "-")}_${fingerprint}`,
    playDate: isSugiyama ? "2026-09-21" : null,
    courseId: course.id,
    courseNameSnapshot: course.courseName,
    courseDefinitionVersion: 1,
    teeSelection: null,
    routing,
    status: "completed",
    startedAt: null,
    endedAt: null,
    roundMemo: null,
    holeLogs,
    createdAt: migratedAt,
    updatedAt: migratedAt,
    migration: { sourceSchemaVersion: 3, sourceStorageKey: storageKeyFor(course), sourceCourseId: course.id, migratedAt, sourceFingerprint: fingerprint, confirmationStatus: "needsReview", playDateSource: isSugiyama ? "userConfirmedForMigration" : "unknown", routingSource: isSugiyama ? "userConfirmedForMigration" : "unknown", teeSelectionSource: "unknown", sourceRecordedAtRange: { first: recordedDates[0] ?? null, last: recordedDates.at(-1) ?? null } },
  };
}

async function migrateV3CourseToV4(course) {
  const records = course.holes.map((hole) => ({ hole, record: normalizeRoundRecord(hole.roundRecord) })).filter(({ record }) => record);
  if (!records.length) return null;
  const fingerprint = simpleV4Fingerprint(records.map(({ hole, record }) => ({ holeNumber: hole.holeNumber, record })));
  const migrationKey = `v3Migration:${course.id}:${fingerprint}`;
  if (await GolfV4Storage.getMetadata(migrationKey)) return null;
  const round = createMigratedV4Round(course, records, fingerprint);
  await GolfV4Storage.putRoundSession(round);
  await GolfV4Storage.setMetadata(migrationKey, { status: "completed", roundId: round.roundId, migratedAt: round.migration.migratedAt });
  return round;
}

async function refreshV4State() {
  v4State.rounds = await GolfV4Storage.listRoundSessions();
  const activeRoundId = await GolfV4Storage.getMetadata(V4_ACTIVE_ROUND_KEY);
  v4State.activeRound = activeRoundId ? await GolfV4Storage.getRoundSession(activeRoundId) : null;
  if (v4State.activeRound?.status !== "inProgress") {
    v4State.activeRound = null;
    if (activeRoundId) await GolfV4Storage.setMetadata(V4_ACTIVE_ROUND_KEY, null);
  }
  renderV4RoundStatus();
}

async function initializeV4Storage() {
  try {
    await GolfV4Storage.open();
    await GolfV4Storage.putCourseDefinitions(courseCatalog.map(v4CourseDefinition));
    const migrated = [];
    for (const course of courseCatalog) {
      const round = await migrateV3CourseToV4(course);
      if (round) migrated.push(round);
    }
    v4State.migrationMessage = migrated.length ? `v3の実戦記録を${migrated.length}ラウンド分、安全に引き継ぎました。` : null;
    v4State.ready = true;
    await refreshV4State();
  } catch (error) {
    v4State.error = error instanceof Error ? error.message : "v4保存領域を準備できませんでした。";
    v4State.ready = false;
    renderV4RoundStatus();
  }
}

async function migrateAvailableV3Records() {
  if (!v4State.ready) return;
  let changed = false;
  for (const course of courseCatalog) {
    if (await migrateV3CourseToV4(course)) changed = true;
  }
  if (changed) await refreshV4State();
}

function renderV4RoundStatus() {
  if (!v4RoundStatus) return;
  if (v4State.error) {
    v4RoundStatus.hidden = false;
    v4RoundStatus.className = "v4-round-status is-error";
    v4RoundStatus.textContent = `ラウンド履歴：利用不可（${v4State.error}）`;
    return;
  }
  if (!v4State.activeRound) {
    v4RoundStatus.hidden = true;
    return;
  }
  v4RoundStatus.hidden = false;
  v4RoundStatus.className = "v4-round-status";
  v4RoundStatus.innerHTML = `<span>進行中のラウンド</span><b>${escapeHtml(v4State.activeRound.courseNameSnapshot)}</b><small>${escapeHtml(v4State.activeRound.playDate ?? "日付未設定")} / ${escapeHtml(v4State.activeRound.routing?.label ?? "順路未設定")}</small>`;
}

async function startV4Round() {
  if (!v4State.ready) throw new Error(v4State.error ?? "v4保存領域の準備中です。");
  if (v4State.activeRound) throw new Error("進行中のラウンドを終了してから、新しいラウンドを開始してください。");
  const round = createV4RoundSession(courseData);
  await GolfV4Storage.putRoundSession(round);
  await GolfV4Storage.setMetadata(V4_ACTIVE_ROUND_KEY, round.roundId);
  v4State.activeRound = round;
  v4State.rounds = [round, ...v4State.rounds];
  resetRoundForNewPlay();
  renderV4RoundStatus();
  return round;
}

async function finishV4Round() {
  if (!v4State.activeRound) return;
  flushPendingReports();
  await reportSaveQueue;
  const now = new Date().toISOString();
  const completed = { ...v4State.activeRound, status: "completed", endedAt: now, updatedAt: now };
  await GolfV4Storage.putRoundSession(completed);
  await GolfV4Storage.setMetadata(V4_ACTIVE_ROUND_KEY, null);
  await refreshV4State();
}

async function syncV3RecordToActiveV4(hole) {
  if (!v4State.activeRound || v4State.activeRound.courseId !== courseData.id || !hole.roundRecord) return;
  const round = await GolfV4Storage.getRoundSession(v4State.activeRound.roundId);
  if (!round || round.status !== "inProgress") return;
  const log = round.holeLogs.find((item) => item.courseHoleRef?.legacyHoleNumber === hole.holeNumber);
  if (!log) return;
  const record = normalizeRoundRecord(hole.roundRecord);
  log.structuredResult = {
    actualClubId: record.actualClubId ?? null,
    actualClubName: record.actualClubName ?? null,
    otherClubName: record.otherClubName ?? null,
    shotResult: record.shotResult ?? null,
    firstPuttDistance: record.firstPuttDistance ?? null,
    todayConditions: record.todayConditions ?? null,
    preRoundMatched: record.preRoundMatched ?? null,
    todayMatched: record.todayMatched ?? null,
    recordedAt: record.recordedAt ?? null,
  };
  log.updatedAt = new Date().toISOString();
  round.updatedAt = log.updatedAt;
  await GolfV4Storage.putRoundSession(round);
  v4State.activeRound = round;
  v4State.rounds = v4State.rounds.map((item) => item.roundId === round.roundId ? round : item);
}

async function resetRoundInputsForCurrentCourse() {
  const now = new Date().toISOString();
  courseData.holes.forEach((hole) => {
    const record = normalizeRoundRecord(hole.roundRecord);
    if (record) {
      hole.roundRecord = {
        ...record,
        actualClubId: null,
        actualClubName: null,
        otherClubName: null,
        shotResult: null,
        firstPuttDistance: null,
        memo: null,
        resultMemo: null,
        preRoundMatched: null,
        todayMatched: null,
        recordedAt: null,
      };
    }
    if (hole.todayAdjustment) hole.todayAdjustment = { ...hole.todayAdjustment, memo: null };
    dirtyRecordHoles.delete(`${courseData.id}:${hole.holeNumber}`);
  });
  saveLandingZones(courseData);

  if (v4State.activeRound?.courseId === courseData.id) {
    const round = await GolfV4Storage.getRoundSession(v4State.activeRound.roundId);
    if (round?.status === "inProgress") {
      round.holeLogs.forEach((log) => {
        log.structuredResult = {
          ...(log.structuredResult ?? {}),
          actualClubId: null,
          actualClubName: null,
          otherClubName: null,
          shotResult: null,
          firstPuttDistance: null,
          preRoundMatched: null,
          todayMatched: null,
          recordedAt: null,
        };
        log.updatedAt = now;
      });
      round.updatedAt = now;
      await GolfV4Storage.putRoundSession(round);
      v4State.activeRound = round;
      v4State.rounds = v4State.rounds.map((item) => item.roundId === round.roundId ? round : item);
    }
  }
}

function reportTypesForPar(par) {
  if (par === 3) return ["tee", "holeOut"];
  if (par === 4) return ["tee", "second", "holeOut"];
  if (par >= 5) return ["tee", "second", "third", "holeOut"];
  return ["tee", "holeOut"];
}

function activeV4HoleLog(holeNumber) {
  if (!v4State.activeRound || v4State.activeRound.courseId !== courseData.id) return null;
  return v4State.activeRound.holeLogs?.find((log) => log.courseHoleRef?.legacyHoleNumber === holeNumber) ?? null;
}

function setReportSaveStatus(holeNumber, type, status, message) {
  const element = strategyCard.querySelector(`.report-save-status[data-hole="${holeNumber}"][data-report-type="${type}"]`);
  if (!element) return;
  element.dataset.status = status;
  element.textContent = message;
  const summaryStatus = element.closest(".hole-report-item")?.querySelector("summary b");
  if (summaryStatus && ["saved", "empty"].includes(status)) summaryStatus.textContent = status === "saved" ? "入力済み" : "未入力";
}

async function persistV4Report({ roundId, courseId, holeNumber, type, text }) {
  if (!v4State.activeRound || v4State.activeRound.roundId !== roundId || v4State.activeRound.courseId !== courseId) throw new Error("保存対象の進行中ラウンドが変わりました。");
  const round = await GolfV4Storage.getRoundSession(roundId);
  if (!round || round.status !== "inProgress" || round.courseId !== courseId) throw new Error("進行中のラウンドが見つかりません。");
  const log = round.holeLogs.find((item) => item.courseHoleRef?.legacyHoleNumber === holeNumber);
  if (!log) throw new Error("このホールの保存先が見つかりません。");
  const definition = reportDefinitions[type];
  if (!definition) throw new Error("報告の種類が正しくありません。");
  const existingIndex = log.reports.findIndex((report) => report.type === type);
  const now = new Date().toISOString();
  if (text.length === 0) {
    if (existingIndex >= 0) log.reports.splice(existingIndex, 1);
  } else {
    const existing = existingIndex >= 0 ? log.reports[existingIndex] : null;
    const report = {
      reportId: existing?.reportId ?? `report-${log.roundHoleId}-${type}`,
      type,
      sequence: Math.max(1, reportTypesForPar(log.holeSnapshot?.par).indexOf(type) + 1),
      text,
      promptId: definition.promptId,
      promptVersion: 1,
      recordedAt: existing?.recordedAt ?? now,
      updatedAt: now,
    };
    if (existingIndex >= 0) log.reports[existingIndex] = report;
    else log.reports.push(report);
    log.reports.sort((a, b) => (a.sequence ?? 99) - (b.sequence ?? 99));
  }
  log.updatedAt = now;
  round.updatedAt = now;
  await GolfV4Storage.putRoundSession(round);
  v4State.activeRound = round;
  v4State.rounds = v4State.rounds.map((item) => item.roundId === round.roundId ? round : item);
}

function queueReportSave(payload) {
  const key = `${payload.roundId}:${payload.holeNumber}:${payload.type}`;
  const editVersion = (reportEditVersions.get(key) ?? 0) + 1;
  reportEditVersions.set(key, editVersion);
  pendingReportSaves.set(key, { ...payload, editVersion });
  clearTimeout(reportSaveTimers.get(key));
  reportSaveTimers.set(key, setTimeout(() => flushReportSave(key), REPORT_AUTOSAVE_DELAY_MS));
}

function flushReportSave(key) {
  clearTimeout(reportSaveTimers.get(key));
  reportSaveTimers.delete(key);
  const payload = pendingReportSaves.get(key);
  if (!payload) return reportSaveQueue;
  pendingReportSaves.delete(key);
  setReportSaveStatus(payload.holeNumber, payload.type, "saving", "保存中");
  reportSaveQueue = reportSaveQueue.then(() => persistV4Report(payload)).then(() => {
    if (reportEditVersions.get(key) === payload.editVersion) setReportSaveStatus(payload.holeNumber, payload.type, payload.text.length ? "saved" : "empty", payload.text.length ? "✓ 保存済み" : "未入力");
  }).catch((error) => {
    if (reportEditVersions.get(key) === payload.editVersion) setReportSaveStatus(payload.holeNumber, payload.type, "error", "保存エラー");
    console.error("Report autosave failed:", error);
  });
  return reportSaveQueue;
}

function flushPendingReports() {
  [...pendingReportSaves.keys()].forEach((key) => flushReportSave(key));
}

function renderHoleReports(hole) {
  const active = v4State.activeRound;
  if (!active || active.courseId !== courseData.id) {
    const message = active ? "進行中ラウンドのコースを選ぶと記録できます。" : "ラウンドを開始すると報告を記録できます。";
    return `<section class="hole-reports is-disabled"><div class="hole-reports-title"><b>ラウンド報告</b><span>未開始</span></div><p>${message}</p></section>`;
  }
  const log = activeV4HoleLog(hole.holeNumber);
  if (!log) return `<section class="hole-reports is-disabled"><div class="hole-reports-title"><b>ラウンド報告</b><span>保存先なし</span></div><p>このホールの保存先を確認してください。</p></section>`;
  const reportByType = new Map((log.reports ?? []).filter((report) => reportDefinitions[report.type]).map((report) => [report.type, report]));
  const fields = reportTypesForPar(hole.par).map((type) => {
    const definition = reportDefinitions[type];
    const report = reportByType.get(type);
    return `<details class="hole-report-item" data-report-type="${type}" ${report?.text ? "" : ""}><summary><span>${definition.label}</span><b>${report?.text ? "入力済み" : "未入力"}</b></summary><div class="hole-report-editor"><p class="report-guide">${escapeHtml(definition.guide).replaceAll("\n", "<br>")}</p><textarea rows="4" data-hole="${hole.holeNumber}" data-report-type="${type}" aria-label="${definition.label}" placeholder="必要なことだけ短く入力してください">${escapeHtml(report?.text ?? "")}</textarea><span class="report-save-status" data-hole="${hole.holeNumber}" data-report-type="${type}" data-status="${report?.text ? "saved" : "empty"}" aria-live="polite">${report?.text ? "✓ 保存済み" : "未入力"}</span></div></details>`;
  }).join("");
  return `<section class="hole-reports"><div class="hole-reports-title"><b>ラウンド報告</b><span>自動保存</span></div>${fields}</section>`;
}

function holeByNumber(number) {
  return courseData.holes.find((hole) => hole.holeNumber === number);
}

function experienceForHole(hole) {
  return roundExperienceByCourse[courseData.id]?.[hole.holeNumber] ?? {};
}

function isSugiyamaCourse() {
  return courseData.id === sugiyamaCourseData.id;
}

function sectionName(section = selected.course) {
  return isSugiyamaCourse() ? (section === "out" ? "西" : "北") : section.toUpperCase();
}

function recordStateKey(holeNumber) {
  return `${courseData.id}:${holeNumber}`;
}

function setRecordSaveButton(button, saved) {
  if (!button) return;
  button.classList.toggle("is-saved", saved);
  button.textContent = saved ? "✓ 保存済み" : "このホールを保存";
}

function markRecordDirty(holeNumber) {
  dirtyRecordHoles.add(recordStateKey(holeNumber));
  setRecordSaveButton(strategyCard.querySelector(`.compact-record-form[data-hole="${holeNumber}"] .compact-save`), false);
}

function todayAdjustmentMatchesRecord(hole, record) {
  const current = normalizedTodayAdjustment(hole);
  const recorded = record.todayConditions ?? {};
  return ["windDirection", "windStrength", "teePosition", "teeDistanceOffset", "ground", "leftHazardDistance", "rightHazardDistance", "frontHazardDistance", "memo"]
    .every((key) => (current[key] ?? null) === (recorded[key] ?? null));
}

function statusValue(value, suffix = "") {
  return value === null ? "未判定" : `${value}${suffix}`;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
}

function normalizeLandingZone(raw) {
  const hasRecordedValue = raw.fairwayWidthYards != null || raw.leftClearanceYards != null || raw.rightClearanceYards != null || raw.dangerComment;
  return {
    distanceFromTee: raw.distanceFromTee ?? raw.distanceYards,
    fairwayWidth: raw.fairwayWidth ?? raw.fairwayWidthYards ?? null,
    leftSafeMargin: raw.leftSafeMargin ?? raw.leftClearanceYards ?? null,
    rightSafeMargin: raw.rightSafeMargin ?? raw.rightClearanceYards ?? null,
    leftHazardType: raw.leftHazardType ?? (raw.leftOb === true ? "ob" : raw.leftOb === false ? "none" : "unconfirmed"),
    rightHazardType: raw.rightHazardType ?? (raw.rightOb === true ? "ob" : raw.rightOb === false ? "none" : "unconfirmed"),
    leftHazardDistance: raw.leftHazardDistance ?? null,
    rightHazardDistance: raw.rightHazardDistance ?? null,
    frontHazardType: raw.frontHazardType ?? "unconfirmed",
    frontHazardDistance: raw.frontHazardDistance ?? null,
    requiredCarryToClear: raw.requiredCarryToClear ?? null,
    notes: raw.notes ?? raw.dangerComment ?? null,
    dataSource: raw.dataSource ?? null,
    qualityStatus: raw.qualityStatus ?? (hasRecordedValue ? "provisional" : "unconfirmed"),
  };
}

function normalizeRoundRecord(record) {
  if (!record || typeof record !== "object" || Array.isArray(record)) return null;
  const rawDistance = record.firstPuttDistance;
  const firstPuttDistance = rawDistance === null || rawDistance === undefined || rawDistance === "" ? null : Number(rawDistance);
  return { ...record, firstPuttDistance: Number.isFinite(firstPuttDistance) && firstPuttDistance >= 0 ? firstPuttDistance : null };
}

function loadSavedLandingZones(targetCourse = courseData) {
  try {
    const saved = JSON.parse(localStorage.getItem(storageKeyFor(targetCourse)));
    if (!saved || typeof saved !== "object") return;
    const savedHoles = saved.course?.holes ?? saved;
    targetCourse.holes.forEach((hole) => {
      const savedHole = Array.isArray(savedHoles[hole.holeNumber]) ? { landingZones: savedHoles[hole.holeNumber] } : savedHoles.find?.((item) => item.holeNumber === hole.holeNumber);
      if (!savedHole) return;
      if (targetCourse.id === sugiyamaCourseData.id) {
        // 予習情報は最新版を維持し、端末で入力した実測・実戦データだけを復元します。
        if (Array.isArray(savedHole.landingZones)) hole.landingZones = savedHole.landingZones.map(normalizeLandingZone);
        if (savedHole.mapData && typeof savedHole.mapData === "object") hole.mapData = { ...hole.mapData, ...savedHole.mapData };
        if (savedHole.todayAdjustment && typeof savedHole.todayAdjustment === "object") hole.todayAdjustment = { ...hole.todayAdjustment, ...savedHole.todayAdjustment };
        if (savedHole.roundRecord) hole.roundRecord = normalizeRoundRecord(savedHole.roundRecord);
        return;
      }
      const normalized = { ...savedHole };
      if (Array.isArray(savedHole.landingZones)) normalized.landingZones = savedHole.landingZones.map(normalizeLandingZone);
      if (savedHole.roundRecord) normalized.roundRecord = normalizeRoundRecord(savedHole.roundRecord);
      Object.assign(hole, normalized);
    });
  } catch {
    // 壊れた保存データは読み込まず、初期の null データを使います。
  }
}

function saveLandingZones(targetCourse = courseData) {
  localStorage.setItem(storageKeyFor(targetCourse), JSON.stringify({ version: 3, course: targetCourse }));
}

function exportCourseData() {
  const backup = { format: "golf-tee-strategy-backup", version: 3, exportedAt: new Date().toISOString(), activeCourseId: courseData.id, courses: courseCatalog, course: courseData };
  const url = URL.createObjectURL(new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `${courseData.id}-backup.json`;
  link.click();
  URL.revokeObjectURL(url);
}

async function importCourseData(file) {
  let backup;
  try {
    backup = JSON.parse(await file.text());
  } catch {
    throw new Error("JSONの形式が正しくありません。");
  }
  const importedCourses = Array.isArray(backup?.courses) ? backup.courses : backup?.course ? [backup.course] : [];
  if (!importedCourses.length) throw new Error("読み込めるコースデータが見つかりません。");
  const matched = importedCourses.flatMap((importedCourse) => {
    // 旧JSONもIDまたは名称が一致したコースへ。未知のコースを現在のコースに誤投入しません。
    const targetCourse = courseCatalog.find((item) => item.id === importedCourse?.id)
      ?? (!importedCourse?.id ? courseCatalog.find((item) => item.courseName === importedCourse?.courseName)
        ?? (!importedCourse?.courseName && importedCourses.length === 1 ? courseCatalog[0] : null) : null);
    if (!targetCourse || !Array.isArray(importedCourse?.holes)) return [];
    return importedCourse.holes
      .filter((importedHole) => importedHole && typeof importedHole === "object")
      .map((importedHole) => ({ importedHole, targetCourse, hole: targetCourse.holes.find((item) => item.holeNumber === Number(importedHole.holeNumber)) }))
      .filter(({ hole }) => Boolean(hole));
  });
  if (matched.length === 0) throw new Error("登録済みコースに一致するID・ホール番号がありません。バックアップ元のコースを確認してください。");

  const previousValues = matched.map(({ hole }) => ({
    hole,
    landingZones: hole.landingZones,
    mapData: hole.mapData,
    todayAdjustment: hole.todayAdjustment,
    roundRecord: hole.roundRecord,
  }));
  let restoredRoundRecords = 0;

  matched.forEach(({ importedHole, hole }) => {
    // 公式コース情報や推薦用データは現行版を維持し、ユーザーが保存した値だけを復元します。
    if (Array.isArray(importedHole.landingZones)) {
      const importedByDistance = new Map(importedHole.landingZones
        .filter((zone) => zone && Number.isFinite(Number(zone.distanceFromTee)))
        .map((zone) => [Number(zone.distanceFromTee), normalizeLandingZone(zone)]));
      const currentDistances = new Set(hole.landingZones.map((zone) => Number(zone.distanceFromTee)));
      hole.landingZones = hole.landingZones.map((zone) => importedByDistance.get(Number(zone.distanceFromTee)) ?? zone);
      importedByDistance.forEach((zone, distance) => {
        if (!currentDistances.has(distance)) hole.landingZones.push(zone);
      });
      hole.landingZones.sort((a, b) => a.distanceFromTee - b.distanceFromTee);
    }
    if (importedHole.mapData && typeof importedHole.mapData === "object" && !Array.isArray(importedHole.mapData)) {
      hole.mapData = {
        ...createEmptyMapData(),
        ...hole.mapData,
        ...importedHole.mapData,
        featureStatus: {
          ...createEmptyMapData().featureStatus,
          ...hole.mapData?.featureStatus,
          ...importedHole.mapData.featureStatus,
        },
      };
    }
    if (importedHole.todayAdjustment && typeof importedHole.todayAdjustment === "object" && !Array.isArray(importedHole.todayAdjustment)) {
      hole.todayAdjustment = { ...hole.todayAdjustment, ...importedHole.todayAdjustment };
    }
    if (importedHole.roundRecord && typeof importedHole.roundRecord === "object" && !Array.isArray(importedHole.roundRecord)) {
      hole.roundRecord = normalizeRoundRecord(importedHole.roundRecord);
      restoredRoundRecords += 1;
    }
  });

  try {
    [...new Set(matched.map(({ targetCourse }) => targetCourse))].forEach((targetCourse) => saveLandingZones(targetCourse));
  } catch {
    previousValues.forEach(({ hole, landingZones, mapData, todayAdjustment, roundRecord }) => {
      hole.landingZones = landingZones;
      hole.mapData = mapData;
      hole.todayAdjustment = todayAdjustment;
      if (roundRecord === undefined) delete hole.roundRecord;
      else hole.roundRecord = roundRecord;
    });
    throw new Error("端末への保存に失敗しました。空き容量を確認してください。");
  }

  const totalHoles = importedCourses.reduce((sum, item) => sum + (Array.isArray(item?.holes) ? item.holes.length : 0), 0);
  return { totalHoles, matchedHoles: matched.length, restoredRoundRecords };
}

function nullableNumber(value) {
  return value === "" || value === null || value === undefined ? null : Number(value);
}

function nullableBoolean(value) {
  return value === "" ? null : value === "true";
}

function inputValue(value) {
  return value == null ? "" : String(value);
}

const hazardOptions = [["unconfirmed", "未確認"], ["ob", "OB"], ["woods", "林"], ["water", "池"], ["creek", "クリーク"], ["bunker", "バンカー"], ["rough", "ラフ"], ["slope", "斜面"], ["none", "なし"]];
const dataSourceOptions = [["", "未選択"], ["official", "公式サイト"], ["aerial", "航空写真"], ["gps", "現地GPS"], ["laser", "レーザー距離計"], ["round", "ラウンド時確認"], ["other", "その他"]];
const qualityOptions = [["unconfirmed", "未確認"], ["provisional", "暫定"], ["confirmed", "確認済み"]];

function selectOptions(options, selected) {
  return options.map(([value, label]) => `<option value="${value}" ${selected === value ? "selected" : ""}>${label}</option>`).join("");
}

function qualityLabel(status) {
  return { unconfirmed: "未入力", provisional: "暫定", confirmed: "確認済み" }[status] ?? "未入力";
}

function verificationStatusLabel(status) {
  return { confirmed: "確認済み", provisional: "暫定", unavailable: "取得できず" }[status] ?? "取得できず";
}

function verificationSourceLabel(source) {
  return { official: "公式サイト", aerial: "航空写真", map: "地図データ", other: "その他" }[source] ?? "―";
}

function mapStatusLabel(status) {
  return { unverified: "未取得", approximate: "暫定", verified: "確認済み" }[status] ?? "未取得";
}

function getMapCoordinate(mapData, prefix) {
  const latitude = mapData?.[`${prefix}Latitude`];
  const longitude = mapData?.[`${prefix}Longitude`];
  return Number.isFinite(latitude) && Number.isFinite(longitude) ? { latitude, longitude } : null;
}

// centerLinePoints は { latitude, longitude, distanceFromTee } を距離順に持つ前提です。
function calculateLandingPoint(hole, club, distanceFromTee = club.totalYards.max) {
  const mapData = hole.mapData;
  const tee = getMapCoordinate(mapData, "tee");
  const points = mapData?.centerLinePoints;
  const targetDistance = distanceFromTee;
  if (!tee || !Array.isArray(points) || points.length === 0 || mapData.dataQuality === "unverified") return null;
  const ordered = [...points].sort((a, b) => a.distanceFromTee - b.distanceFromTee);
  const next = ordered.find((point) => point.distanceFromTee >= targetDistance);
  const previous = [...ordered].reverse().find((point) => point.distanceFromTee <= targetDistance) ?? { ...tee, distanceFromTee: 0 };
  if (!next || !Number.isFinite(next.latitude) || !Number.isFinite(next.longitude)) return null;
  if (next.distanceFromTee === previous.distanceFromTee) return { latitude: next.latitude, longitude: next.longitude, distanceFromTee: targetDistance };
  const ratio = (targetDistance - previous.distanceFromTee) / (next.distanceFromTee - previous.distanceFromTee);
  return { latitude: previous.latitude + (next.latitude - previous.latitude) * ratio, longitude: previous.longitude + (next.longitude - previous.longitude) * ratio, distanceFromTee: targetDistance };
}

function calculateClubLandingAreas(hole, club) {
  return {
    carry: calculateLandingPoint(hole, club, club.carryYards),
    totalMin: calculateLandingPoint(hole, club, club.totalYards.min),
    totalMax: calculateLandingPoint(hole, club, club.totalYards.max),
  };
}

function calculateFairwayWidth(hole, landingPoint) {
  if (!landingPoint || !hole.mapData?.fairwayPolygon || hole.mapData.dataQuality !== "verified") return null;
  // GISのポリゴン交差計算は、確認済みの座標データ導入後にここへ実装します。
  return null;
}

function calculateDistanceToHazard(hole, landingPoint, hazardKey) {
  if (!landingPoint || !hole.mapData?.[hazardKey] || hole.mapData.dataQuality !== "verified") return null;
  // ハザードポリゴンへの最短距離計算は、確認済み座標を前提に実装します。
  return null;
}

function evaluateMapBasedClubRisk(hole, club) {
  const landingPoint = calculateClubLandingAreas(hole, club).totalMax;
  if (!landingPoint || hole.mapData?.dataQuality !== "verified") {
    return { status: "unverified", landingPoint: null, fairwayWidth: null, hazardDistances: null };
  }
  return {
    status: "ready-for-calculation",
    landingPoint,
    fairwayWidth: calculateFairwayWidth(hole, landingPoint),
    hazardDistances: {
      bunker: calculateDistanceToHazard(hole, landingPoint, "bunkerPolygons"),
      water: calculateDistanceToHazard(hole, landingPoint, "waterPolygons"),
      ob: calculateDistanceToHazard(hole, landingPoint, "obAreas"),
      trees: calculateDistanceToHazard(hole, landingPoint, "treeAreas"),
    },
  };
}

function renderMapDataStatus(hole) {
  const mapData = hole.mapData;
  const items = [["ティー座標", "teeCoordinates"], ["グリーン座標", "greenCoordinates"], ["フェアウェイ形状", "fairwayShape"], ["バンカー形状", "bunkerShapes"], ["水域", "waterAreas"], ["OBエリア", "obAreas"], ["林エリア", "treeAreas"]];
  return `<section class="map-status" aria-labelledby="map-status-title">
    <div class="map-status-title"><div><h2 id="map-status-title">地図データ状況</h2><p>開発用：座標・形状データが揃うまで暫定判定には反映しません。</p></div><span>${mapStatusLabel(mapData?.dataQuality)}</span></div>
    <div class="map-status-grid">${items.map(([label, key]) => `<div><span>${label}</span><b class="map-${mapData?.featureStatus?.[key] ?? "unverified"}">${mapStatusLabel(mapData?.featureStatus?.[key])}</b></div>`).join("")}</div>
  </section>`;
}

const mapFeatureLabels = { teeCoordinates: "ティー座標", greenCoordinates: "グリーン座標", centerLinePoints: "センターライン", fairwayShape: "フェアウェイ形状", bunkerShapes: "バンカー形状", waterAreas: "水域", obAreas: "OB境界", treeAreas: "林エリア" };

function coordinateFromGeoJson(coordinates) {
  return Array.isArray(coordinates) && Number.isFinite(coordinates[0]) && Number.isFinite(coordinates[1]) ? { latitude: coordinates[1], longitude: coordinates[0] } : null;
}

function mapRole(properties = {}) {
  const text = Object.values(properties).join(" ").toLowerCase();
  if (text.includes("tee") || text.includes("ティー")) return "tee";
  if (text.includes("green") || text.includes("グリーン")) return "green";
  if (text.includes("center") || text.includes("centerline") || text.includes("センター")) return "centerline";
  if (text.includes("fairway") || text.includes("フェアウェイ")) return "fairway";
  if (text.includes("bunker") || text.includes("バンカー")) return "bunker";
  if (text.includes("water") || text.includes("pond") || text.includes("creek") || text.includes("池") || text.includes("クリーク")) return "water";
  if (text.includes("tree") || text.includes("woods") || text.includes("林")) return "trees";
  if (text.includes("ob") || text.includes("out_of_bounds") || text.includes("境界")) return "ob";
  if (text.includes("hole") || text.includes("ホール")) return "hole";
  return null;
}

function markImportedFeature(mapData, key) {
  mapData.featureStatus[key] = "approximate";
}

function createMapCandidate() {
  return createEmptyMapData();
}

function parseGeoJsonToMapData(input) {
  const candidate = createMapCandidate();
  const warnings = [];
  const features = input.type === "FeatureCollection" ? input.features : input.type === "Feature" ? [input] : [];
  if (!features.length) throw new Error("GeoJSONのFeatureが見つかりません。");
  features.forEach((feature) => {
    const geometry = feature?.geometry;
    const role = mapRole(feature?.properties);
    if (!geometry || !role) return;
    if (geometry.type === "Point") {
      const point = coordinateFromGeoJson(geometry.coordinates);
      if (role === "tee" && point) { candidate.teeLatitude = point.latitude; candidate.teeLongitude = point.longitude; markImportedFeature(candidate, "teeCoordinates"); }
      if (role === "green" && point) { candidate.greenLatitude = point.latitude; candidate.greenLongitude = point.longitude; markImportedFeature(candidate, "greenCoordinates"); }
    }
    if (geometry.type === "LineString" && role === "centerline") {
      const distances = feature.properties?.distanceFromTee ?? feature.properties?.distancesFromTee;
      if (Array.isArray(distances) && distances.length === geometry.coordinates.length) {
        candidate.centerLinePoints = geometry.coordinates.map((coordinate, index) => ({ ...coordinateFromGeoJson(coordinate), distanceFromTee: Number(distances[index]) }));
        markImportedFeature(candidate, "centerLinePoints");
      } else warnings.push("センターラインには距離順の distanceFromTee 配列が必要です。");
    }
    if ((geometry.type === "Polygon" || geometry.type === "MultiPolygon") && role) {
      const geometryData = geometry.coordinates;
      if (role === "fairway") { candidate.fairwayPolygon = geometryData; markImportedFeature(candidate, "fairwayShape"); }
      if (role === "bunker") { candidate.bunkerPolygons = geometryData; markImportedFeature(candidate, "bunkerShapes"); }
      if (role === "water") { candidate.waterPolygons = geometryData; markImportedFeature(candidate, "waterAreas"); }
      if (role === "trees") { candidate.treeAreas = geometryData; markImportedFeature(candidate, "treeAreas"); }
      if (role === "ob") { candidate.obAreas = geometryData; markImportedFeature(candidate, "obAreas"); }
    }
  });
  return { mapData: candidate, warnings };
}

function parseCsvRows(text) {
  const [headerLine, ...lines] = text.trim().split(/\r?\n/);
  if (!headerLine || !lines.length) throw new Error("CSVのヘッダーまたはデータ行が見つかりません。");
  const headers = headerLine.split(",").map((value) => value.trim().toLowerCase());
  return lines.filter(Boolean).map((line) => Object.fromEntries(line.split(",").map((value, index) => [headers[index], value.trim()])));
}

function parseCsvToMapData(text) {
  const candidate = createMapCandidate();
  const warnings = [];
  const groups = {};
  parseCsvRows(text).forEach((row) => {
    const role = mapRole({ role: row.role ?? row.feature ?? row.type ?? row.name });
    const toNumber = (value) => value === "" || value == null ? Number.NaN : Number(value);
    const latitude = toNumber(row.latitude ?? row.lat);
    const longitude = toNumber(row.longitude ?? row.lon ?? row.lng);
    const distanceFromTee = toNumber(row.distancefromtee ?? row.distance_from_tee);
    if (!role || !Number.isFinite(latitude) || !Number.isFinite(longitude)) return;
    (groups[role] ??= []).push({ latitude, longitude, distanceFromTee });
  });
  if (groups.tee?.[0]) { candidate.teeLatitude = groups.tee[0].latitude; candidate.teeLongitude = groups.tee[0].longitude; markImportedFeature(candidate, "teeCoordinates"); }
  if (groups.green?.[0]) { candidate.greenLatitude = groups.green[0].latitude; candidate.greenLongitude = groups.green[0].longitude; markImportedFeature(candidate, "greenCoordinates"); }
  if (groups.centerline) {
    if (groups.centerline.every((point) => Number.isFinite(point.distanceFromTee))) { candidate.centerLinePoints = groups.centerline; markImportedFeature(candidate, "centerLinePoints"); }
    else warnings.push("CSVのセンターラインには distanceFromTee 列が必要です。");
  }
  const polygons = [["fairway", "fairwayPolygon", "fairwayShape"], ["bunker", "bunkerPolygons", "bunkerShapes"], ["water", "waterPolygons", "waterAreas"], ["trees", "treeAreas", "treeAreas"], ["ob", "obAreas", "obAreas"]];
  polygons.forEach(([role, dataKey, statusKey]) => {
    if (groups[role]?.length >= 3) { candidate[dataKey] = groups[role].map(({ latitude, longitude }) => [longitude, latitude]); markImportedFeature(candidate, statusKey); }
    else if (groups[role]) warnings.push(`${mapFeatureLabels[statusKey]}には3点以上の座標が必要です。`);
  });
  return { mapData: candidate, warnings };
}

function parseJsonToMapData(input) {
  if (input.type === "FeatureCollection" || input.type === "Feature") return parseGeoJsonToMapData(input);
  const raw = input.mapData ?? input;
  if (!raw || typeof raw !== "object") throw new Error("mapDataを含むJSONではありません。");
  const candidate = createMapCandidate();
  ["teeLatitude", "teeLongitude", "greenLatitude", "greenLongitude", "centerLinePoints", "fairwayPolygon", "bunkerPolygons", "waterPolygons", "obAreas", "treeAreas"].forEach((key) => {
    if (raw[key] != null) candidate[key] = raw[key];
  });
  const statusMap = { teeCoordinates: candidate.teeLatitude != null && candidate.teeLongitude != null, greenCoordinates: candidate.greenLatitude != null && candidate.greenLongitude != null, centerLinePoints: Array.isArray(candidate.centerLinePoints), fairwayShape: candidate.fairwayPolygon != null, bunkerShapes: candidate.bunkerPolygons != null, waterAreas: candidate.waterPolygons != null, obAreas: candidate.obAreas != null, treeAreas: candidate.treeAreas != null };
  Object.entries(statusMap).forEach(([key, exists]) => { if (exists) markImportedFeature(candidate, key); });
  return { mapData: candidate, warnings: [] };
}

async function buildMapImportPreview(file) {
  const fileName = file.name.toLowerCase();
  const text = await file.text();
  let format;
  let parsed;
  if (fileName.endsWith(".csv") || file.type === "text/csv") { format = "CSV"; parsed = parseCsvToMapData(text); }
  else {
    let json;
    try { json = JSON.parse(text); } catch { throw new Error("JSONまたはGeoJSONとして読み込めませんでした。"); }
    format = json.type === "FeatureCollection" || json.type === "Feature" ? "GeoJSON" : "JSON";
    parsed = parseJsonToMapData(json);
  }
  parsed.mapData.dataSource = `ファイル：${file.name}`;
  parsed.mapData.dataQuality = "approximate";
  return { ...parsed, format, fileName: file.name };
}

function importedFeatureNames(mapData) {
  return Object.entries(mapData.featureStatus).filter(([, status]) => status === "approximate").map(([key]) => mapFeatureLabels[key]);
}

function renderMapImportPanel() {
  const preview = mapImportPreview;
  return `<section class="map-import" aria-labelledby="map-import-title"><h2 id="map-import-title">地図データを読み込む</h2><p>GeoJSON、JSON、CSVを選択し、変換結果を確認してから保存します。</p><label class="map-file-button">ファイルを選択<input id="mapDataFile" type="file" accept=".geojson,.json,.csv,application/geo+json,application/json,text/csv" /></label>
    ${mapImportError ? `<div class="map-import-error">${escapeHtml(mapImportError)}</div>` : ""}
    ${preview ? `<div class="map-preview"><b>${preview.format}：${escapeHtml(preview.fileName)}</b><p>読み込めた要素：${importedFeatureNames(preview.mapData).join("、") || "なし"}</p>${preview.warnings.length ? `<p class="map-preview-warning">不足：${preview.warnings.map(escapeHtml).join("／")}</p>` : ""}<div class="map-preview-actions"><button id="saveMapApproximate" type="button">暫定として保存</button><button id="saveMapVerified" type="button">確認済みとして保存</button></div></div>` : ""}
  </section>`;
}

function analyzeOsmGeoJson(text) {
  let geoJson;
  try { geoJson = JSON.parse(text); } catch { throw new Error("GeoJSONとして解析できません。JSON形式を確認してください。"); }
  const features = geoJson.type === "FeatureCollection" ? geoJson.features : geoJson.type === "Feature" ? [geoJson] : null;
  if (!Array.isArray(features)) throw new Error("FeatureCollection または Feature が必要です。");
  // ファイルインポートと同じGeoJSON変換器に通し、保存前の解釈を確認します。
  const parsed = parseGeoJsonToMapData(geoJson);
  const counts = { tee: 0, fairway: 0, green: 0, bunker: 0, water: 0, hole: 0 };
  features.forEach((feature) => {
    const role = mapRole(feature?.properties);
    if (role && Object.prototype.hasOwnProperty.call(counts, role)) counts[role] += 1;
  });
  return { counts, imported: importedFeatureNames(parsed.mapData), warnings: parsed.warnings };
}

function renderOsmGeoJsonTester() {
  const result = osmGeoJsonResult;
  return `<section class="osm-tester" aria-labelledby="osm-tester-title"><h2 id="osm-tester-title">OpenStreetMap GeoJSONテスト</h2><p>Overpass等から手動で取得したGeoJSONを貼り付け、要素名が認識されるか確認します。保存やAPI取得は行いません。</p><textarea id="osmGeoJsonInput" rows="8" placeholder='{"type":"FeatureCollection","features":[...]}'>${escapeHtml(osmGeoJsonText)}</textarea><button id="previewOsmGeoJson" type="button">プレビュー</button>
    ${osmGeoJsonError ? `<div class="osm-error">${escapeHtml(osmGeoJsonError)}</div>` : ""}
    ${result ? `<div class="osm-result"><div class="osm-counts">${Object.entries(result.counts).map(([type, count]) => `<span>${type}：<b>${count}件</b></span>`).join("")}</div><p>mapDataへ変換可能な要素：${result.imported.join("、") || "なし"}</p>${result.warnings.length ? `<p class="osm-warning">不足：${result.warnings.map(escapeHtml).join("／")}</p>` : ""}</div>` : ""}
  </section>`;
}

function saveMapImport(quality) {
  if (!mapImportPreview) return;
  const mapData = mapImportPreview.mapData;
  if (importedFeatureNames(mapData).length === 0) {
    mapImportError = "保存できる地図要素がありません。座標列と要素種別を確認してください。";
    return;
  }
  mapData.dataQuality = quality;
  Object.entries(mapData.featureStatus).forEach(([key, status]) => { if (status === "approximate" && quality === "verified") mapData.featureStatus[key] = "verified"; });
  holeByNumber(1).mapData = mapData;
  saveLandingZones();
  mapImportPreview = null;
  mapImportError = null;
}

function renderVerificationScreen() {
  const hole = holeByNumber(1);
  const verification = hole.dataVerification;
  const items = verification.items.map((item) => `
    <article class="verification-item">
      <div><h3>${item.label}</h3><p>${item.value ?? "公開情報・現在のコースデータからは取得できず"}</p></div>
      <div class="verification-meta"><b class="verification-status ${item.status}">${verificationStatusLabel(item.status)}</b>${item.dataSource ? `<span>${verificationSourceLabel(item.dataSource)}</span>` : ""}</div>
    </article>`).join("");
  verificationScreen.innerHTML = `
    <div class="verification-heading"><button id="closeVerification" type="button">‹ コース画面へ戻る</button><p class="eyebrow">DATA CHECK</p><h2>1番ホール データ確認</h2><p>精密判定に必要な情報を、公開情報で確認できる範囲だけ整理しています。</p></div>
    <div class="verification-overview"><span>Regularティー</span><b>${hole.regularYardage} yd</b><em>確認済み・公式サイト</em></div>
    <div class="verification-list">${items}</div>
    ${renderOsmGeoJsonTester()}
    ${renderMapImportPanel()}
    <p class="verification-source">出典：<a href="${verification.sourceUrl}" target="_blank" rel="noopener noreferrer">鬼ノ城ゴルフ倶楽部 公式 1番ホール</a></p>`;
}

function showVerificationScreen(show) {
  playSurface.hidden = show;
  developerScreen.hidden = true;
  verificationScreen.hidden = !show;
  bottomNav.hidden = true;
  if (show) renderVerificationScreen();
}

function renderV4RoundManager() {
  if (v4State.error) return `<section class="v4-round-manager is-error"><h2>ラウンド履歴（v4）</h2><p>IndexedDBを利用できません：${escapeHtml(v4State.error)}</p><p>既存のv3記録機能は引き続き利用できます。</p></section>`;
  const active = v4State.activeRound;
  const rows = v4State.rounds.map((round) => {
    const recorded = round.holeLogs?.filter((log) => Object.keys(log.structuredResult ?? {}).length || (log.reports?.length ?? 0) > 0).length ?? 0;
    const status = round.status === "inProgress" ? "進行中" : "完了";
    return `<article class="v4-round-row"><div><b>${escapeHtml(round.courseNameSnapshot)}</b><span class="v4-status-${round.status}">${status}</span></div><p>${escapeHtml(round.playDate ?? "日付未確認")} / ${escapeHtml(round.routing?.label ?? "順路未確認")} / 記録 ${recorded}ホール</p><small>${round.migration ? "v3から引き継ぎ・要確認" : escapeHtml(round.roundId)}</small></article>`;
  }).join("");
  return `<section class="v4-round-manager"><h2>ラウンド履歴（v4）</h2><p>過去ラウンドを上書きせず、端末内のIndexedDBへ保存します。</p>${v4State.migrationMessage ? `<p class="v4-migration-message">${escapeHtml(v4State.migrationMessage)}</p>` : ""}${active ? `<div class="v4-active-round"><span>現在進行中</span><b>${escapeHtml(active.courseNameSnapshot)}</b><p>${escapeHtml(active.playDate)} / ${escapeHtml(active.routing?.label ?? "順路未設定")}</p><button id="finishV4Round" type="button">このラウンドを終了</button></div>` : `<button id="startNewRound" class="developer-action developer-action-danger" type="button" ${v4State.ready ? "" : "disabled"}>新しいラウンドを開始</button>`}<button id="resetRoundInputs" class="developer-action developer-action-reset" type="button">ラウンドをリセット</button><p class="v4-reset-note">現在選択中のコースの使用クラブ・結果・1stパット距離・メモだけを初期化します。戦略と報告原文は残ります。</p><details class="v4-round-history" ${v4State.rounds.length ? "" : "hidden"}><summary>保存済みラウンド ${v4State.rounds.length}件</summary><div>${rows}</div></details>${!v4State.ready ? `<p class="v4-preparing">v4保存領域を準備しています…</p>` : ""}</section>`;
}

function renderDeveloperScreen() {
  const hole = holeByNumber(selected.hole);
  developerScreen.innerHTML = `<div class="developer-heading"><button id="closeDeveloper" type="button">‹ プレー画面へ戻る</button><p class="eyebrow">SETTINGS / DEVELOPMENT</p><h2>設定 / 開発</h2><p>実測値、地図データ、JSONバックアップを扱う画面です。プレー中の判断には表示しません。</p></div>
    <div id="developerHoleSelector" class="developer-hole-selector">${Array.from({ length: 18 }, (_, index) => { const number = index + 1; return `<button type="button" data-developer-hole="${number}" aria-pressed="${selected.hole === number}">${number}</button>`; }).join("")}</div>
    ${renderV4RoundManager()}
    ${renderRecommendationValidation()}
    ${renderRoundVerification()}
    ${courseData.id === "kinnojo-out" && hole.holeNumber === 1 ? `<button id="openVerification" class="developer-action" type="button">1番ホール データ確認・地図インポート</button>` : ""}
    ${renderMapDataStatus(hole)}
    <div class="edit-area"><button id="developerEditToggle" class="edit-button" type="button" aria-expanded="${editMode}">${editMode ? "編集を閉じる" : "コースデータを編集"}</button></div>
    ${editMode ? renderEditor(hole) : ""}`;
}

function renderRecommendationValidation() {
  const validationHoles = courseData.holes.filter((hole) => hole.fieldValidation);
  if (!validationHoles.length) return "";
  const cards = validationHoles.map((hole) => {
    const result = evaluatePersonalizedRecommendation(hole);
    const expected = hole.fieldValidation;
    const primaryMatches = result.primary.club.id === expected.primaryClub;
    const secondaryMatches = result.secondary?.club.id === expected.secondaryClub;
    const matches = primaryMatches && secondaryMatches;
    const factorList = result.primary.factors.map((factor) => `<li>${escapeHtml(factor.label)} <b>${factor.points > 0 ? "+" : ""}${factor.points}</b></li>`).join("");
    return `<article class="validation-card"><div><b>OUT ${hole.holeNumber}</b><span class="validation-${matches ? "match" : "miss"}">${matches ? "一致 ○" : "一致 ×"}</span></div><p><small>アルゴリズム推奨</small>${result.primary.club.name} / ${result.secondary?.club.name ?? "未判定"}</p><p><small>実戦正解</small>${clubData.find((club) => club.id === expected.primaryClub)?.name} / ${clubData.find((club) => club.id === expected.secondaryClub)?.name}</p><p class="validation-reason">${result.primary.reasons.map(escapeHtml).join("・")}</p><details><summary>${result.primary.club.name} の判定内訳</summary><ul>${factorList}</ul><p>リスク ${result.primary.riskPenalty} / 許容 ${result.primary.riskLimit}、飛距離メリット +${result.primary.distanceBenefit}</p></details></article>`;
  }).join("");
  return `<section class="recommendation-validation"><h2>実戦正解との検証</h2><p>実戦経験の正解データは、エンジンの出力を強制しない比較専用データです。</p><div>${cards}</div></section>`;
}

function renderRoundVerification() {
  const resultLabel = { fw: "FW", left: "左", right: "右", "ob-left": "OB左", "ob-right": "OB右", other: "その他" };
  const recorded = courseData.holes.filter((hole) => hole.roundRecord?.recordedAt);
  const preCompared = recorded.filter((hole) => hole.roundRecord.preRoundMatched != null);
  const todayCompared = recorded.filter((hole) => hole.roundRecord.todayMatched != null);
  const percentage = (items, key) => items.length ? `${Math.round(items.filter((hole) => hole.roundRecord[key]).length / items.length * 100)}%` : "―";
  const counts = {
    fw: recorded.filter((hole) => hole.roundRecord.shotResult === "fw").length,
    left: recorded.filter((hole) => hole.roundRecord.shotResult === "left").length,
    right: recorded.filter((hole) => hole.roundRecord.shotResult === "right").length,
    ob: recorded.filter((hole) => ["ob-left", "ob-right"].includes(hole.roundRecord.shotResult)).length,
  };
  const records = courseData.holes.map((hole) => {
    const record = hole.roundRecord ?? {};
    const clubName = (id) => clubData.find((club) => club.id === id)?.name ?? "対象外";
    const conditions = record.todayConditions ?? {};
    const conditionText = [conditions.windDirection && `風:${todayLabel("windDirection", conditions.windDirection)}`, conditions.windStrength && `強さ:${todayLabel("windStrength", conditions.windStrength)}`, conditions.teePosition && `ティー:${todayLabel("teePosition", conditions.teePosition)}`, conditions.teeDistanceOffset != null && `基準差:${conditions.teeDistanceOffset > 0 ? "+" : ""}${conditions.teeDistanceOffset}yd`, conditions.ground && `地面:${todayLabel("ground", conditions.ground)}`].filter(Boolean).join(" / ") || "未入力";
    const courseName = sectionName(hole.holeNumber <= 9 ? "out" : "in");
    const displayNumber = isSugiyamaCourse() ? hole.sectionHoleNumber : hole.holeNumber;
    const distance = record.distanceYards ?? hole.tees?.[selected.tee]?.distanceYards ?? hole.regularYardage;
    const preLabel = hole.par === 3 ? "対象外" : record.preRoundPrimaryClub ? clubName(record.preRoundPrimaryClub) : isSugiyamaCourse() ? "現地判断" : "対象外";
    const todayLabelText = record.todayPrimaryClub ? clubName(record.todayPrimaryClub) : isSugiyamaCourse() ? "未計算" : "対象外";
    return `<article class="round-record-row"><h3>${courseName} ${displayNumber} <span>PAR ${hole.par} / ${distance ?? "―"}yd</span></h3><p>基本：${preLabel}　攻め：${record.preRoundAggressiveClub ? clubName(record.preRoundAggressiveClub) : "―"}　当日：${todayLabelText}</p><p>実際：${escapeHtml(record.actualClubName ?? "未入力")}　結果：${resultLabel[record.shotResult] ?? "未入力"}　1stパット：${record.firstPuttDistance ?? "―"}${record.firstPuttDistance != null ? "m" : ""}</p><p class="round-meta">条件：${escapeHtml(conditionText)}　事前一致：${record.preRoundMatched == null ? "―" : record.preRoundMatched ? "○" : "×"}　当日一致：${record.todayMatched == null ? "―" : record.todayMatched ? "○" : "×"}</p>${record.memo ? `<p class="round-meta">状況メモ：${escapeHtml(record.memo)}</p>` : ""}${record.resultMemo ? `<p class="round-meta">結果メモ：${escapeHtml(record.resultMemo)}</p>` : ""}</article>`;
  }).join("");
  return `<section class="round-verification"><h2>ラウンド検証結果</h2><p>${isSugiyamaCourse() ? "西 / 北" : "OUT / IN"} 18ホールを一覧表示します。集計は学習ロジックには反映しません。</p><div class="round-summary"><div><span>記録済み</span><b>${recorded.length} / 18</b></div><div><span>事前推奨一致率</span><b>${percentage(preCompared, "preRoundMatched")}</b></div><div><span>当日推奨一致率</span><b>${percentage(todayCompared, "todayMatched")}</b></div><div><span>FW</span><b>${counts.fw}</b></div><div><span>左ミス / 右ミス</span><b>${counts.left} / ${counts.right}</b></div><div><span>OB</span><b>${counts.ob}</b></div></div><div>${records}</div></section>`;
}

function resetRoundForNewPlay() {
  courseData.holes.forEach((hole) => {
    hole.todayAdjustment = { teePosition: null, wind: null, ground: null, hazards: [], memo: null };
    delete hole.roundRecord;
  });
  saveLandingZones();
  selected.hole = 1;
  selected.course = "out";
  todayEditMode = false;
}

function renderCurrentPlayState() {
  renderSelectors();
  renderStrategy();
}

function showDeveloperScreen(show) {
  playSurface.hidden = show;
  verificationScreen.hidden = true;
  developerScreen.hidden = !show;
  bottomNav.hidden = true;
  if (show) renderDeveloperScreen();
  else renderCurrentPlayState();
}

function isZoneReadyForPrecision(zone) {
  const hasHazardEvidence = (type, distance) => type === "none" || (type !== "unconfirmed" && distance != null);
  const frontClearanceKnown = zone.frontHazardType === "none" || zone.requiredCarryToClear != null;
  return zone.qualityStatus === "confirmed" && zone.dataSource != null && zone.fairwayWidth != null && zone.leftSafeMargin != null && zone.rightSafeMargin != null && hasHazardEvidence(zone.leftHazardType, zone.leftHazardDistance) && hasHazardEvidence(zone.rightHazardType, zone.rightHazardDistance) && hasHazardEvidence(zone.frontHazardType, zone.frontHazardDistance) && frontClearanceKnown;
}

function isHoleReadyForPrecision(hole) {
  return landingZoneDistances.every((distance) => isZoneReadyForPrecision(hole.landingZones.find((zone) => zone.distanceFromTee === distance) ?? {}));
}

function renderEditor(hole) {
  const rows = [...hole.landingZones].sort((a, b) => a.distanceFromTee - b.distanceFromTee).map((zone) => `
    <fieldset class="zone-editor" data-distance="${zone.distanceFromTee}">
      <legend><span>${zone.distanceFromTee} yd 地点</span><b class="quality-badge quality-${zone.qualityStatus}">${qualityLabel(zone.qualityStatus)}</b></legend>
      <div class="editor-fields">
        <label class="editor-field-wide">データ品質<select name="qualityStatus">${selectOptions(qualityOptions, zone.qualityStatus)}</select></label>
        <label>フェアウェイ幅（yd）<input type="number" inputmode="decimal" min="0" name="fairwayWidth" value="${inputValue(zone.fairwayWidth)}" placeholder="未入力" /></label>
        <label>左側の安全余裕（yd）<input type="number" inputmode="decimal" min="0" name="leftSafeMargin" value="${inputValue(zone.leftSafeMargin)}" placeholder="未入力" /></label>
        <label>右側の安全余裕（yd）<input type="number" inputmode="decimal" min="0" name="rightSafeMargin" value="${inputValue(zone.rightSafeMargin)}" placeholder="未入力" /></label>
        <label>左側ハザード<select name="leftHazardType">${selectOptions(hazardOptions, zone.leftHazardType)}</select></label>
        <label>左側までの距離（yd）<input type="number" inputmode="decimal" min="0" name="leftHazardDistance" value="${inputValue(zone.leftHazardDistance)}" placeholder="未入力" /></label>
        <label>右側ハザード<select name="rightHazardType">${selectOptions(hazardOptions, zone.rightHazardType)}</select></label>
        <label>右側までの距離（yd）<input type="number" inputmode="decimal" min="0" name="rightHazardDistance" value="${inputValue(zone.rightHazardDistance)}" placeholder="未入力" /></label>
        <label>正面ハザード<select name="frontHazardType">${selectOptions(hazardOptions, zone.frontHazardType)}</select></label>
        <label>正面までの距離（yd）<input type="number" inputmode="decimal" min="0" name="frontHazardDistance" value="${inputValue(zone.frontHazardDistance)}" placeholder="未入力" /></label>
        <label>越えるためのキャリー（yd）<input type="number" inputmode="decimal" min="0" name="requiredCarryToClear" value="${inputValue(zone.requiredCarryToClear)}" placeholder="未入力" /></label>
        <label>データソース<select name="dataSource">${selectOptions(dataSourceOptions, zone.dataSource ?? "")}</select></label>
        <label class="editor-field-wide">メモ<textarea name="notes" rows="2" placeholder="確認内容・測定条件など">${escapeHtml(zone.notes ?? "")}</textarea></label>
      </div>
    </fieldset>`).join("");
  const precisionStatus = isHoleReadyForPrecision(hole) ? "精密判定可能" : "精密判定の準備中";
  return `<section class="course-editor" aria-labelledby="course-editor-title">
    <div class="editor-title"><div><h2 id="course-editor-title">コースデータ編集</h2><p>確認済みの実測値だけを入力してください。空欄は未登録（null）のまま保存されます。</p></div><span class="precision-status ${isHoleReadyForPrecision(hole) ? "ready" : ""}">${precisionStatus}</span></div>
    <div class="backup-actions"><button id="exportData" type="button">JSONを書き出す</button><label class="import-button">JSONを読み込む<input id="importData" type="file" accept="application/json" /></label></div>
    ${backupImportMessage ? `<p class="backup-import-message ${backupImportStatus === "error" ? "error" : "success"}" role="${backupImportStatus === "error" ? "alert" : "status"}">${escapeHtml(backupImportMessage)}</p>` : ""}
    <form id="addDistanceForm" class="add-distance"><label>距離地点を追加<input type="number" inputmode="decimal" min="1" name="distanceFromTee" placeholder="例：220" required /></label><button type="submit">追加</button></form>
    <form id="landingZoneForm">${rows}<button class="save-button" type="submit">この内容を保存</button></form>
  </section>`;
}

function clubRiskWeight(club) {
  return { driver: 1, "3w": 0.72, "5w": 0.43, "3u": 0.22, "4u": 0.12 }[club.id];
}

function gradeFromScore(score) {
  if (score >= 66) return "A";
  if (score >= 54) return "B";
  if (score >= 42) return "C";
  return "D";
}

function evaluateStrategicRisk(hole) {
  const profile = hole.provisionalProfile;
  if (!profile) return { severity: 0, level: "低", reasons: ["公式攻略情報が未確認"], available: false };
  let severity = 0;
  const reasons = [];
  if (profile.fairwayCharacter === "narrowing") { severity += 1; reasons.push("フェアウェイが先細り"); }
  if (profile.lateralRisk === "high") { severity += 2; reasons.push("左右の危険が明記されている"); }
  if (profile.lateralRisk === "moderate") { severity += 1; reasons.push("ティーショット周辺に注意点あり"); }
  if (profile.longClubCaution) { severity += 1; reasons.push("飛距離を出しすぎない方針"); }
  const level = severity >= 2 ? "高" : severity === 1 ? "中" : "低";
  return { severity: Math.min(severity, 2), level, reasons: reasons.length ? reasons : ["公式攻略上の大きな制約は未確認"], available: true };
}

function evaluateStatisticalRisk(hole) {
  const stats = hole.publicStats;
  if (!stats || stats.obRate == null || stats.fwKeepRate == null) return { severity: 0, level: "低", reasons: ["公開統計は未取得"], available: false };
  let points = 0;
  const reasons = [];
  if (stats.obRate >= 25) { points += 2; reasons.push(`OB率 ${stats.obRate}%`); }
  else if (stats.obRate >= 20) { points += 1; reasons.push(`OB率 ${stats.obRate}%`); }
  if (stats.fwKeepRate < 50 && hole.par !== 3) { points += 2; reasons.push(`FWキープ率 ${stats.fwKeepRate}%`); }
  else if (stats.fwKeepRate < 55 && hole.par !== 3) { points += 1; reasons.push(`FWキープ率 ${stats.fwKeepRate}%`); }
  if (stats.bunkerRate >= 40) { points += 1; reasons.push(`バンカー率 ${stats.bunkerRate}%`); }
  if (stats.difficultyRank != null && stats.difficultyRank <= 5) { points += 1; reasons.push(`難易度 ${stats.difficultyRank}位`); }
  const severity = points >= 3 ? 2 : points >= 1 ? 1 : 0;
  return { severity, level: ["低", "中", "高"][severity], reasons: reasons.length ? reasons : ["公開統計は比較的安定"], available: true };
}

function evaluateHoleRisk(hole) {
  const strategic = evaluateStrategicRisk(hole);
  const statistical = evaluateStatisticalRisk(hole);
  // 公開統計はホール全体の傾向なので、コース固有情報の半分の重みで組み合わせます。
  const combined = strategic.severity * 2 + statistical.severity;
  const level = combined >= 5 ? "高" : combined >= 2 ? "中" : "低";
  return { level, strategic, statistical, reasons: [...strategic.reasons, ...statistical.reasons].slice(0, 3) };
}

const todayChoices = {
  windDirection: [["none", "なし"], ["headwind", "アゲンスト"], ["tailwind", "フォロー"], ["from-left", "左から"], ["from-right", "右から"]],
  windStrength: [["weak", "弱"], ["medium", "中"], ["strong", "強"]],
  teePosition: [["front", "前"], ["normal", "通常"], ["back", "後ろ"]],
  ground: [["normal", "通常"], ["soft", "柔らかい"], ["hard", "硬い"]],
};

function todayLabel(field, value) {
  return todayChoices[field]?.find(([id]) => id === value)?.[1] ?? "未入力";
}

function renderTodayChoices(field, title, selected) {
  return `<fieldset class="today-field"><legend>${title}</legend><div class="today-choices">${todayChoices[field].map(([value, label]) => `<label><input type="radio" name="${field}" value="${value}" ${selected === value ? "checked" : ""}/><span>${label}</span></label>`).join("")}</div></fieldset>`;
}

function normalizedTodayAdjustment(hole) {
  const saved = hole.todayAdjustment ?? {};
  const legacyWind = saved.wind === "strong-headwind" ? ["headwind", "strong"] : saved.wind === "headwind" ? ["headwind", null] : saved.wind === "tailwind" ? ["tailwind", null] : saved.wind === "strong-tailwind" ? ["tailwind", "strong"] : saved.wind === "calm" ? ["none", null] : [null, null];
  const legacyHazards = saved.hazards ?? [];
  const legacyDistance = (side) => legacyHazards.find((hazard) => hazard.name?.includes(side))?.distanceYards ?? null;
  return { windDirection: saved.windDirection ?? legacyWind[0], windStrength: saved.windStrength ?? legacyWind[1], teePosition: saved.teePosition ?? null, teeDistanceOffset: saved.teeDistanceOffset ?? null, ground: saved.ground ?? null, leftHazardDistance: saved.leftHazardDistance ?? legacyDistance("左"), rightHazardDistance: saved.rightHazardDistance ?? legacyDistance("右"), frontHazardDistance: saved.frontHazardDistance ?? legacyDistance("正面"), memo: saved.memo ?? null, hazards: legacyHazards };
}

function todayHazards(adjustment) {
  const teeOffset = adjustment.teeDistanceOffset ?? 0;
  return [["left", "左ハザード", adjustment.leftHazardDistance], ["right", "右ハザード", adjustment.rightHazardDistance], ["front", "正面ハザード", adjustment.frontHazardDistance]].filter(([, , distance]) => distance != null).map(([side, name, baseDistance]) => ({ side, name, baseDistance, adjustedDistance: rounded(baseDistance + teeOffset) }));
}

function calculateEffectiveClubDistance(club, adjustment) {
  const windRate = todayAdjustmentCoefficients.windCarry[adjustment.windDirection]?.[adjustment.windStrength] ?? 0;
  const runMultiplier = todayAdjustmentCoefficients.groundRun[adjustment.ground] ?? 1;
  const carry = rounded(club.carryYards * (1 + windRate));
  const runMin = rounded((club.totalYards.min - club.carryYards) * runMultiplier);
  const runMax = rounded((club.totalYards.max - club.carryYards) * runMultiplier);
  return { carry, total: { min: rounded(carry + runMin), max: rounded(carry + runMax) }, windRate, runMultiplier };
}

function todayConditionReasons(hole, adjustment, effectiveDistance) {
  const reasons = [];
  if (effectiveDistance.windRate !== 0) reasons.push(`${todayLabel("windDirection", adjustment.windDirection)}（${todayLabel("windStrength", adjustment.windStrength)}）でCarry ${effectiveDistance.windRate > 0 ? "+" : ""}${Math.round(effectiveDistance.windRate * 100)}%`);
  if (adjustment.ground === "soft") reasons.push("柔らかい地面でRunを抑制");
  if (adjustment.ground === "hard") reasons.push("硬い地面でRunが増加");
  if (adjustment.teeDistanceOffset != null && adjustment.teeDistanceOffset !== 0) reasons.push(`基準位置との差 ${adjustment.teeDistanceOffset > 0 ? "+" : ""}${adjustment.teeDistanceOffset}yd`);
  if (adjustment.windDirection === "from-left" && hole.rightHazardSeverity !== "none") reasons.push("左からの風と右側リスクを確認");
  if (adjustment.windDirection === "from-right" && hole.leftHazardSeverity !== "none") reasons.push("右からの風と左側リスクを確認");
  return reasons;
}

function hazardMarginCategory(hole, side) {
  const direction = { left: "左", right: "右", front: "正面" }[side];
  const text = `${hole.mainRisk ?? ""}。${hole.mainRisks ?? ""}`;
  const clauses = text.split(/[。、]/).filter((clause) => !direction || clause.includes(direction));
  const relevantText = clauses.join(" ") || text;
  if (/(OB|池|クリーク|深い林)/i.test(relevantText)) return "major";
  if (/バンカー/.test(relevantText)) return "bunker";
  if (/(ラフ|斜面)/.test(relevantText)) return "minor";
  const severity = side === "front" ? "unknown" : hole[`${side}HazardSeverity`] ?? "none";
  return severity === "high" ? "major" : severity === "low" ? "minor" : "unknown";
}

function hazardSafetyMarginForHole(hole, side) {
  const coefficients = todayAdjustmentCoefficients;
  const category = hazardMarginCategory(hole, side);
  const baseMargin = coefficients.hazardSafetyMargin[category] ?? coefficients.hazardSafetyMargin.unknown;
  if (side !== "left" && side !== "right") return { category, margin: baseMargin };
  const oppositeSide = side === "left" ? "right" : "left";
  const escapeRoom = hole[`${oppositeSide}EscapeRoom`] ?? "unknown";
  const reduction = coefficients.oppositeEscapeReduction[escapeRoom] ?? 0;
  return { category, margin: Math.max(3, baseMargin - reduction) };
}

function evaluateTodayClubAgainstHazards(hole, club, adjustment, hazards) {
  const effectiveDistance = calculateEffectiveClubDistance(club, adjustment);
  const tendency = clubTendency(club);
  const exposure = personalizedEngineWeights.clubExposure[club.id];
  const checks = hazards.map((hazard) => {
    const directionalMargin = hazard.side === "left" || hazard.side === "right" ? tendency[`${hazard.side}MissTendency`] * todayAdjustmentCoefficients.sideTendencyMargin * exposure : 0;
    const marginRule = hazardSafetyMarginForHole(hole, hazard.side);
    const requiredMargin = rounded(marginRule.margin + directionalMargin);
    const safetyMargin = rounded(hazard.adjustedDistance - effectiveDistance.total.max);
    return { ...hazard, hazardCategory: marginRule.category, requiredMargin, safetyMargin, buffer: rounded(safetyMargin - requiredMargin), safe: safetyMargin >= requiredMargin };
  });
  const strategic = evaluateTeeRiskClub(hole, club);
  const hazardSafe = checks.every((check) => check.safe);
  const strategicallyAllowed = strategic.status !== "非推奨";
  return { club, effectiveDistance, checks, strategic, hazardSafe, strategicallyAllowed, acceptable: hazardSafe && strategicallyAllowed, worstBuffer: checks.length ? Math.min(...checks.map((check) => check.buffer)) : null };
}

function evaluateTodayRecommendation(hole, preRecommendation) {
  const adjustment = normalizedTodayAdjustment(hole);
  if (!preRecommendation) return { primary: null, changed: false, reasons: [] };
  const hazards = todayHazards(adjustment);
  const evaluatedClubs = clubData.map((club) => evaluateTodayClubAgainstHazards(hole, club, adjustment, hazards));
  const preCandidate = evaluatedClubs.find((item) => item.club.id === preRecommendation.primary.club.id);
  if (!hazards.length) return { primary: preCandidate, changed: false, reasons: todayConditionReasons(hole, adjustment, preCandidate.effectiveDistance).slice(0, 2), hazards, evaluations: evaluatedClubs, adjustedHoleDistance: rounded(hole.regularYardage + (adjustment.teeDistanceOffset ?? 0)) };
  const candidate = evaluatedClubs.find((item) => item.acceptable) ?? evaluatedClubs.slice().sort((a, b) => b.worstBuffer - a.worstBuffer || clubData.indexOf(a.club) - clubData.indexOf(b.club))[0];
  const changed = candidate.club.id !== preRecommendation.primary.club.id;
  const conditionReasons = todayConditionReasons(hole, adjustment, candidate.effectiveDistance);
  const limitingCheck = candidate.checks.slice().sort((a, b) => a.buffer - b.buffer)[0];
  const hazardReason = `${candidate.club.name}の実効Total ${candidate.effectiveDistance.total.max}yd、${limitingCheck.name} ${limitingCheck.adjustedDistance}ydに安全余裕 ${limitingCheck.safetyMargin}yd`;
  const reasons = [...conditionReasons, hazardReason];
  return { primary: candidate, changed, reasons: reasons.slice(0, 2), hazards, evaluations: evaluatedClubs, closestHazard: limitingCheck, adjustedHoleDistance: rounded(hole.regularYardage + (adjustment.teeDistanceOffset ?? 0)) };
}

function renderTodayDistanceComparison(today) {
  return `<details class="today-compare"><summary>クラブ別の距離比較</summary><div>${today.evaluations.map((item) => { const limiting = item.checks.slice().sort((a, b) => a.buffer - b.buffer)[0]; const status = !limiting ? "距離確認用" : item.acceptable ? `余裕 ${limiting.safetyMargin}yd` : !item.strategicallyAllowed ? "事前リスク注意" : `余裕不足 ${limiting.safetyMargin}yd`; return `<p><b>${item.club.name}</b><span>通常 C${item.club.carryYards} / T${item.club.totalYards.min}〜${item.club.totalYards.max}<br>今日 C${item.effectiveDistance.carry} / T${item.effectiveDistance.total.min}〜${item.effectiveDistance.total.max}yd</span><em>${status}</em></p>`; }).join("")}</div></details>`;
}

function renderTodayAdjustment(hole, preRecommendation = null) {
  const adjustment = normalizedTodayAdjustment(hole);
  const today = evaluateTodayRecommendation(hole, preRecommendation);
  const hasTodayInput = [adjustment.windDirection, adjustment.windStrength, adjustment.teePosition, adjustment.teeDistanceOffset, adjustment.ground, adjustment.leftHazardDistance, adjustment.rightHazardDistance, adjustment.frontHazardDistance, adjustment.memo].some((value) => value != null);
  const summary = [adjustment.windDirection && `風：${todayLabel("windDirection", adjustment.windDirection)}`, adjustment.windStrength && `強さ：${todayLabel("windStrength", adjustment.windStrength)}`, adjustment.teePosition && `ティー：${todayLabel("teePosition", adjustment.teePosition)}`, adjustment.teeDistanceOffset != null && `基準差：${adjustment.teeDistanceOffset > 0 ? "+" : ""}${adjustment.teeDistanceOffset}yd`, adjustment.ground && `地面：${todayLabel("ground", adjustment.ground)}`].filter(Boolean);
  return `<details class="today-adjustment compact-detail"><summary><span><small>OPTION</small>詳細記録</span><b>${hasTodayInput ? "入力済み" : "必要な時だけ"}</b></summary><form class="today-adjustment-form" data-hole="${hole.holeNumber}">
      ${renderTodayChoices("windDirection", "風", adjustment.windDirection)}
      ${renderTodayChoices("windStrength", "風の強さ", adjustment.windStrength)}
      ${renderTodayChoices("teePosition", "ティー位置", adjustment.teePosition)}
      <label class="tee-offset">基準位置からの距離差（yd）<input name="teeDistanceOffset" type="number" inputmode="numeric" value="${inputValue(adjustment.teeDistanceOffset)}" placeholder="前 -10 / 後ろ +15" /></label>
      ${renderTodayChoices("ground", "地面", adjustment.ground)}
      <fieldset class="today-field"><legend>主要ハザードまでの距離（任意）</legend><div class="today-distance-grid"><label>左<input name="leftHazardDistance" type="number" inputmode="decimal" min="1" value="${inputValue(adjustment.leftHazardDistance)}" placeholder="yd" /></label><label>右<input name="rightHazardDistance" type="number" inputmode="decimal" min="1" value="${inputValue(adjustment.rightHazardDistance)}" placeholder="yd" /></label><label>正面<input name="frontHazardDistance" type="number" inputmode="decimal" min="1" value="${inputValue(adjustment.frontHazardDistance)}" placeholder="yd" /></label></div></fieldset>
      <label class="today-memo">自由メモ<textarea name="todayMemo" rows="2" placeholder="例：右は広く見える。左からの風">${escapeHtml(adjustment.memo ?? "")}</textarea></label><button class="today-save" type="submit">今日の状況を反映</button></form>
      ${preRecommendation ? `<div class="today-recommendation"><span>当日推奨</span><strong>${today.primary.club.name}</strong>${today.changed ? `<p>事前：${preRecommendation.primary.club.name} ↓ 今日：${today.primary.club.name}</p>` : `<p>${hasTodayInput ? "事前推奨を維持" : "入力がないため事前推奨をそのまま表示"}</p>`}<div class="effective-distance"><span>通常距離<b>Carry ${today.primary.club.carryYards}yd<br>Total ${today.primary.club.totalYards.min}〜${today.primary.club.totalYards.max}yd</b></span><span>今日の実効距離<b>Carry ${today.primary.effectiveDistance.carry}yd<br>Total ${today.primary.effectiveDistance.total.min}〜${today.primary.effectiveDistance.total.max}yd</b></span></div>${today.adjustedHoleDistance !== hole.regularYardage ? `<p>当日ホール距離：${hole.regularYardage} → ${today.adjustedHoleDistance}yd</p>` : ""}${today.closestHazard && today.closestHazard.baseDistance !== today.closestHazard.adjustedDistance ? `<p>${today.closestHazard.name}：${today.closestHazard.baseDistance} → ${today.closestHazard.adjustedDistance}yd</p>` : ""}${today.reasons.length ? `<ul>${today.reasons.map((reason) => `<li>${escapeHtml(reason)}</li>`).join("")}</ul>` : ""}</div>` : ""}
      ${preRecommendation ? renderTodayDistanceComparison(today) : ""}
      ${summary.length ? `<p class="today-summary">${summary.join("　")}</p>` : ""}
    </details>`;
}

function clubTendency(club) {
  return playerProfile.clubTendencies[club.id] ?? playerProfile;
}

function rounded(value) {
  return Math.round(value * 10) / 10;
}

// 重大リスクが許容範囲に入るクラブのうち、最も長いクラブを選びます。
// 安全なほど高得点にはせず、短くすることによる飛距離損失も別に評価します。
function evaluateTeeRiskClub(hole, club) {
  const weights = personalizedEngineWeights;
  const exposure = weights.clubExposure[club.id];
  const tendency = clubTendency(club);
  const factors = [];
  let riskPenalty = 0;
  const applySideRisk = (side) => {
    const severity = hole[`${side}HazardSeverity`] ?? "none";
    const severityValue = weights.hazardBySeverity[severity] ?? 0;
    if (!severityValue) return;
    const missTendency = tendency[`${side}MissTendency`] ?? playerProfile[`${side}MissTendency`];
    const oppositeSide = side === "left" ? "right" : "left";
    const escapeRoom = hole[`${oppositeSide}EscapeRoom`] ?? "unknown";
    const hazardPenalty = severityValue * weights.hazardPenalty * exposure;
    const tendencyPenalty = severityValue * missTendency * weights.tendencyPenalty * exposure;
    const escapeCredit = weights.escapeCredit[escapeRoom] * exposure;
    const appliedEscapeCredit = Math.min(escapeCredit, hazardPenalty + tendencyPenalty);
    riskPenalty += hazardPenalty + tendencyPenalty - appliedEscapeCredit;
    factors.push({ label: `${side === "left" ? "左" : "右"}ハザード`, points: -rounded(hazardPenalty) });
    factors.push({ label: `${side === "left" ? "左" : "右"}ミス傾向`, points: -rounded(tendencyPenalty) });
    if (appliedEscapeCredit) factors.push({ label: `${oppositeSide === "left" ? "左" : "右"}の逃げ場`, points: rounded(appliedEscapeCredit) });
    if (club.id === "driver" && severity === "high" && missTendency > (tendency[`${oppositeSide}MissTendency`] ?? playerProfile[`${oppositeSide}MissTendency`])) {
      riskPenalty += weights.driverStrongSidePenalty;
      factors.push({ label: "Driverの強いミス方向", points: -weights.driverStrongSidePenalty });
    }
  };
  applySideRisk("left");
  applySideRisk("right");
  if (hole.fairwayNarrowsWithDistance) {
    const narrowingPenalty = weights.narrowingPenalty * exposure;
    riskPenalty += narrowingPenalty;
    factors.push({ label: "距離で先細り", points: -rounded(narrowingPenalty) });
  }
  const distanceValue = hole.distanceValue ?? "normal";
  const distanceBenefit = weights.distanceBenefit[club.id] * (weights.distanceValueMultiplier[distanceValue] ?? 1);
  factors.push({ label: "飛距離メリット", points: rounded(distanceBenefit) });
  const riskLimit = (weights.confidenceRiskLimit[hole.strategyConfidence] ?? weights.confidenceRiskLimit.low) + (distanceValue === "high" ? 4 : distanceValue === "low" ? -1 : 0);
  const score = rounded(70 + distanceBenefit - riskPenalty);
  const safe = riskPenalty <= riskLimit;
  const caution = !safe && riskPenalty <= riskLimit + weights.cautionBand;
  return {
    club,
    score,
    riskPenalty: rounded(riskPenalty),
    distanceBenefit: rounded(distanceBenefit),
    riskLimit,
    factors,
    status: safe ? "推奨" : caution ? "注意" : "非推奨",
    safe,
    caution,
  };
}

function conciseRecommendationReasons(hole, candidate, primary) {
  const reasons = [];
  if (hole.leftHazardSeverity === "high" && playerProfile.leftMissTendency > playerProfile.rightMissTendency) reasons.push("左への大きなミスに注意");
  if (hole.rightHazardSeverity === "high" && hole.leftEscapeRoom === "large") reasons.push("右リスクに対して左の逃げ場を確保");
  if (hole.fairwayNarrowsWithDistance) reasons.push("先細り前の着弾を優先");
  if (candidate.club.id !== "driver") reasons.push(`Driverとの差は約${clubData[0].carryYards - candidate.club.carryYards}yd`);
  if (hole.par === 5 && candidate.club.id === "driver") reasons.push("PAR5の次打距離を確保");
  if (!reasons.length) reasons.push("許容リスク内で最長クラブを優先");
  if (primary && candidate.club.id === primary.club.id) reasons.push(candidate.safe ? "重大リスクが暫定許容範囲内" : "許容候補なし・当日確認が必要");
  return [...new Set(reasons)].slice(0, 3);
}

function evaluatePersonalizedClub(hole, club) {
  const base = evaluateTeeRiskClub(hole, club);
  const weights = wholeHoleWeights;
  const experience = experienceForHole(hole);
  const total = (club.totalYards.min + club.totalYards.max) / 2;
  const remainingDistance = Number.isFinite(hole.regularYardage) ? Math.max(0, hole.regularYardage - total) : null;
  const shortHole = hole.par === 4 && clubData.some(c => ["5w", "3u", "4u"].includes(c.id) && hole.regularYardage - c.totalYards.min <= 100);
  const remainingValue = hole.par === 4 && remainingDistance != null ? weights.remainingBands.find(b => remainingDistance < b.upper).points - Math.max(0, remainingDistance - weights.longApproachThreshold) * weights.longApproachCostPerYard : 0;
  const oneSidedEscape = ["left", "right"].some(side => hole[`${side}HazardSeverity`] !== "none" && hole[`${side === "left" ? "right" : "left"}HazardSeverity`] === "none" && hole[`${side === "left" ? "right" : "left"}EscapeRoom`] === "large");
  let riskPenalty = base.riskPenalty * (oneSidedEscape ? weights.oneSidedEscapeScale : 1);
  if (experience.landingWidthNotSeverelyNarrow) riskPenalty *= weights.verifiedPlayableWidthScale;
  let riskLimit = base.riskLimit;
  if (experience.landingWidthNotSeverelyNarrow || experience.sustainedUphill) riskLimit = weights.twoSidedRiskLimit;
  if (experience.shortLayupBlocksNextShot) riskLimit += weights.routeRiskAllowance;
  const distanceBenefit = base.distanceBenefit * (shortHole ? weights.shortHoleDistanceScale : experience.sustainedUphill ? weights.uphillDistanceScale : 1);
  const blockedNextShotCost = experience.shortLayupBlocksNextShot && clubData[0].carryYards - club.carryYards > weights.layupDistanceLossThreshold ? weights.blockedSecondShotPenalty : 0;
  const safe = riskPenalty <= riskLimit;
  const attackAllowance = experience.sustainedUphill ? weights.uphillAttackRiskAllowance : experience.separateShortcut ? weights.shortcutAttackRiskAllowance : weights.attackRiskAllowance;
  return { ...base, remainingDistance: remainingDistance == null ? null : rounded(remainingDistance), riskPenalty: rounded(riskPenalty), riskLimit, distanceBenefit: rounded(distanceBenefit),
    score: rounded(70 + distanceBenefit + remainingValue - riskPenalty * weights.riskScoreScale - blockedNextShotCost),
    safe, caution: !safe && riskPenalty <= riskLimit + attackAllowance,
    status: safe ? "推奨" : riskPenalty <= riskLimit + attackAllowance ? "注意" : "非推奨",
    factors: [{ label: "逃げ場・実戦条件を反映したリスク", points: -rounded(riskPenalty * weights.riskScoreScale) }, { label: "飛距離メリット", points: rounded(distanceBenefit) }, { label: "残り距離の価値", points: rounded(remainingValue) }, { label: "次打の林・刻みすぎ", points: -blockedNextShotCost }],
  };
}

function evaluatePersonalizedRecommendation(hole) {
  const evaluations = clubData.map((club) => evaluatePersonalizedClub(hole, club));
  const ranked = evaluations.slice().sort((a, b) => b.score - a.score);
  const primary = ranked.find(item => item.safe) ?? ranked[0];
  const aggressiveOption = evaluations.filter(item => item.club.carryYards > primary.club.carryYards && (item.safe || item.caution)).sort((a,b) => a.club.carryYards - b.club.carryYards)[0] ?? null;
  const secondary = aggressiveOption ?? ranked.find(item => item !== primary && item.safe) ?? ranked.find(item => item !== primary);
  const avoid = evaluations.find((item) => item.status === "非推奨") ?? null;
  primary.reasons = [hole.par === 4 ? `想定残り約${Math.round(primary.remainingDistance)}yd` : "次打距離と重大リスクのバランス", ...(experienceForHole(hole).separateShortcut ? ["基本は折れ曲がりへの安全ルート"] : []), ...conciseRecommendationReasons(hole, primary, primary)].slice(0, 3);
  if (secondary) secondary.reasons = conciseRecommendationReasons(hole, secondary, primary);
  if (aggressiveOption) aggressiveOption.conditions = experienceForHole(hole).separateShortcut ? ["バンカー越えのCarryと安全ルートを当日確認"] : ["左右の着弾幅とハザード距離を当日確認"];
  return { primary, secondary, primaryRecommendation: primary, aggressiveOption, avoid, evaluations };
}

function recommendationForPlay(hole) {
  if (hole.par === 3) return null;
  if (!isSugiyamaCourse()) return evaluatePersonalizedRecommendation(hole);
  const candidate = hole.preRoundStrategyCandidate;
  if (!candidate) return null;
  const club = clubData.find((item) => item.id === candidate.primaryClub);
  const aggressiveClub = clubData.find((item) => item.id === candidate.aggressiveClub);
  if (!club) return null;
  const primary = { club, reasons: [candidate.reason] };
  const aggressiveOption = aggressiveClub ? { club: aggressiveClub } : null;
  return { primary, primaryRecommendation: primary, secondary: aggressiveOption, aggressiveOption, avoid: null };
}

function renderShotRecord(hole, preRecommendation = null) {
  const record = hole.roundRecord ?? {};
  const today = evaluateTodayRecommendation(hole, preRecommendation);
  const clubOptions = [...clubData, { id: "other", name: "その他" }];
  const resultOptions = [["fw", "FW"], ["left", "左"], ["right", "右"], ["ob-left", "OB左"], ["ob-right", "OB右"], ["other", "その他"]];
  return `<section class="shot-record" aria-labelledby="shot-record-title"><h2 id="shot-record-title">実際のティーショット</h2><form id="shotRecordForm"><fieldset class="today-field"><legend>実際に使用したクラブ</legend><div class="record-choices">${clubOptions.map((club) => `<label><input type="radio" name="actualClub" value="${club.id}" ${record.actualClubId === club.id ? "checked" : ""}/><span>${club.name}</span></label>`).join("")}</div><input class="other-club" name="otherClub" value="${escapeHtml(record.otherClubName ?? "")}" placeholder="その他のクラブ名" /></fieldset><fieldset class="today-field"><legend>ティーショット結果</legend><div class="record-choices result-choices">${resultOptions.map(([id, label]) => `<label><input type="radio" name="shotResult" value="${id}" ${record.shotResult === id ? "checked" : ""}/><span>${label}</span></label>`).join("")}</div></fieldset><label class="today-memo">結果メモ（任意）<textarea name="shotResultMemo" rows="2" placeholder="例：左ラフ、残り150yd">${escapeHtml(record.resultMemo ?? "")}</textarea></label><button class="record-save" type="submit">このホールを記録</button></form>${record.recordedAt ? `<p class="record-saved">記録済み：${record.actualClubName ?? "クラブ未入力"} / ${resultOptions.find(([id]) => id === record.shotResult)?.[1] ?? "結果未入力"}</p>` : ""}</section>`;
}

function renderTacticalPlay(hole) {
  const recommendation = evaluatePersonalizedRecommendation(hole);
  const assessments = clubData.map((club) => evaluateClubForHole(hole, club)).sort((a, b) => b.score - a.score);
  const brief = hole.tacticalBrief ?? { risks: ["公式攻略情報からの追加確認が必要"], checks: ["ティー位置", "主要ハザードまでの距離", "左右どちらが広く見えるか"] };
  const confidenceLabel = { high: "高", medium: "中", low: "低" };
  const assessmentDetail = assessments.map((item) => `<div><span>${item.club.name}</span><b>${item.grade}</b></div>`).join("");
  const primary = recommendation.primaryRecommendation;
  const aggressive = recommendation.aggressiveOption;
  const aggressiveDescription = experienceForHole(hole).separateShortcut ? "リスクを取ってショートカットを狙う" : "リスクを許容して距離を稼ぐ";
  return `<section class="tactical-play" aria-label="実戦用ティーショット判断">
    <section class="pre-recommendation"><div class="tactical-heading"><span>事前戦略</span><b>信頼度：${confidenceLabel[hole.strategyConfidence] ?? "低"}</b></div><div class="pre-strategies"><article class="strategy-option strategy-option-primary"><span>推奨クラブ</span><strong>${primary.club.name}</strong><p>安全性・残り距離・ホール攻略を総合した基本戦略</p></article>${aggressive ? `<article class="strategy-option strategy-option-aggressive"><span>攻めるなら</span><strong>${aggressive.club.name}</strong><p>${aggressiveDescription}</p>${aggressive.conditions?.length ? `<small>${aggressive.conditions.map(escapeHtml).join("・")}</small>` : ""}</article>` : ""}<div class="strategy-avoid"><span>注意 / 非推奨</span><strong>${recommendation.avoid?.club.name ?? "なし"}</strong></div></div><p class="pre-reason"><b>推奨理由：</b>${primary.reasons.map(escapeHtml).join("・")}</p><p>当日の距離・風・目視で最終判断してください。</p></section>
    <section class="tactical-card"><h2>主要リスク</h2><div class="risk-chips">${brief.risks.map((risk) => `<span>${escapeHtml(risk)}</span>`).join("")}</div></section>
    <section class="tactical-card check-card"><h2>当日確認ポイント</h2><ul>${brief.checks.map((check) => `<li>カートナビで ${escapeHtml(check)} を確認</li>`).join("")}</ul></section>
    ${renderTodayAdjustment(hole, recommendation)}
    ${renderShotRecord(hole, recommendation)}
    <details class="a-d-details"><summary>A〜D暫定評価の詳細</summary><p>公開情報・統計を使った補助評価です。</p><div class="a-d-grid">${assessmentDetail}</div></details>
  </section>`;
}

// 実測値が揃うまでの定性ルール。将来は landingZones を使う精密判定に差し替えます。
function evaluateClubForHole(hole, club) {
  const profile = hole.provisionalProfile;
  if (!profile) return { club, grade: "未判定", score: 0, reason: "公式攻略の判定材料が未確認です。", provisional: true };

  const weight = clubRiskWeight(club);
  const statisticalRisk = evaluateStatisticalRisk(hole);
  let score = 65;
  const reasons = [];
  if (profile.fairwayCharacter === "wide") {
    score += 10 * weight;
    reasons.push("広いフェアウェイとセンター狙いを考慮");
  }
  if (profile.fairwayCharacter === "narrowing") {
    score -= 20 * weight;
    reasons.push("先細りのため長いクラブは注意");
  }
  if (profile.lateralRisk === "moderate") score -= 6 * weight;
  if (profile.lateralRisk === "high") {
    score -= 14 * weight;
    reasons.push("左右の危険を考慮");
  }
  if (profile.longClubCaution) {
    score -= 14 * weight;
    reasons.push("飛距離を出しすぎない方針を考慮");
  }
  if (statisticalRisk.severity > 0) {
    score -= statisticalRisk.severity * 3 * weight;
    reasons.push("公開統計は補助材料として反映");
  }
  if (hole.par === 5) {
    score += { driver: 4, "3w": 5, "5w": 3, "3u": 1, "4u": 0 }[club.id];
    reasons.push("PAR5の次打距離も考慮");
  }
  if (profile.preferredClubIds.includes(club.id)) {
    score += 8;
    reasons.unshift("安全な着弾を優先する暫定候補");
  }
  if (reasons.length === 0) reasons.push("公式攻略をもとに暫定評価");
  return { club, grade: gradeFromScore(score), score, reason: reasons.slice(0, 2).join("・"), provisional: true };
}

function renderClubSafety(hole) {
  const holeRisk = evaluateHoleRisk(hole);
  const stats = hole.publicStats;
  const assessments = clubData.map((club) => evaluateClubForHole(hole, club));
  const recommended = [...assessments].sort((a, b) => b.score - a.score).slice(0, 2);
  const rows = assessments.map((assessment) => {
    const { club } = assessment;
    return `
      <article class="club-safety-item">
        <div class="club-safety-heading"><h3>${club.name}</h3><span class="safety-status">${assessment.grade}</span></div>
        <div class="club-distances"><span>Carry <b>${club.carryYards} yd</b></span><span>Total <b>${club.totalYards.min}〜${club.totalYards.max} yd</b></span></div>
        <p><b>暫定判定：</b>${assessment.reason}</p>
      </article>`;
  }).join("");
  return `<section class="club-safety" aria-labelledby="club-safety-title">
    <div class="club-safety-title"><h2 id="club-safety-title">事前推奨・クラブ別暫定判定</h2><span>暫定</span></div>
    <div class="hole-risk-panel"><div class="hole-risk-title"><span>ホールリスク</span><b class="risk-${holeRisk.level}">${holeRisk.level}</b></div>
      <div class="public-stats"><span>FWキープ率 <b>${stats?.fwKeepRate ?? "―"}${stats?.fwKeepRate != null ? "%" : ""}</b></span><span>OB率 <b>${stats?.obRate ?? "―"}${stats?.obRate != null ? "%" : ""}</b></span><span>バンカー率 <b>${stats?.bunkerRate ?? "―"}${stats?.bunkerRate != null ? "%" : ""}</b></span></div>
      <p><b>判定根拠：</b>${holeRisk.reasons.join("・")}</p>${stats?.dataSource ? `<small>${stats.dataSource}／${stats.dataPeriod ?? "期間未確認"}</small>` : ""}
    </div>
    <div class="recommendation-panel"><span>おすすめ候補 <small>安全性と残り距離の暫定バランス</small></span><ol>${recommended.map((item) => `<li><b>${item.club.name}</b><em>${item.grade}</em></li>`).join("")}</ol></div>
    ${rows}
  </section>`;
}

function renderPar3Notice() {
  return `<section class="par3-notice" aria-label="PAR3のティーショット戦略について">
    <b>PAR3</b><p>ティーショット戦略クラブ判定の対象外です。</p>
  </section>`;
}

function renderSelectors() {
  const isOut = selected.course === "out";
  const firstHole = isOut ? 1 : 10;
  coursePicker.innerHTML = courseCatalog.map((course) => `<option value="${escapeHtml(course.id)}" ${course.id === courseData.id ? "selected" : ""}>${escapeHtml(course.courseName)}</option>`).join("");
  courseSelector.innerHTML = ["out", "in"].map((course) => `<button type="button" data-course="${course}" aria-pressed="${selected.course === course}">${sectionName(course)}</button>`).join("");
  holeSelector.innerHTML = Array.from({ length: 9 }, (_, index) => {
    const number = firstHole + index;
    const isSelected = selected.hole === number;
    return `<button class="hole-button" type="button" aria-pressed="${isSelected}" data-hole="${number}">${number}</button>`;
  }).join("");
  document.querySelector("#courseTitle").textContent = courseData.courseName;
  document.querySelector("#courseLabel").textContent = `${sectionName()} COURSE`;
  document.querySelector("#holeProgress").textContent = `${sectionName()} 9ホール`;
  courseSelector.setAttribute("aria-label", isSugiyamaCourse() ? "西・北コース切り替え" : "OUT・INコース切り替え");
  const previousButton = document.querySelector("#previousButton");
  const nextButton = document.querySelector("#nextButton");
  previousButton.disabled = selected.hole === 1;
  nextButton.disabled = selected.hole === 18;
  nextButton.querySelector("span").textContent = selected.hole === 18 ? "ラウンド終了" : "次のホール";

  teeSelector.innerHTML = courseData.tees.map((tee) => `
    <button class="tee-button" type="button" role="radio" aria-checked="${selected.tee === tee.id}" data-tee="${tee.id}">${tee.name}</button>
  `).join("");
}

function compactRiskText(hole) {
  const risks = hole.tacticalBrief?.risks?.filter(Boolean) ?? [];
  if (risks.length) return risks.slice(0, 2).join("／");
  return hole.mainRisk ?? hole.mainRisks ?? "未確認";
}

function compactSelectOptions(options, currentValue, emptyLabel) {
  return `<option value="">${emptyLabel}</option>${options.map(([value, label]) => `<option value="${value}" ${currentValue === value ? "selected" : ""}>${label}</option>`).join("")}`;
}

function renderCoursePreview(hole) {
  const preview = hole.coursePreview;
  if (!preview) return "";
  const rows = [
    ["形状", preview.shape],
    ["狙い目", preview.aim],
    ["Tショット注意", preview.teeRisk],
    ["次打以降", preview.nextShot],
  ].filter(([, value]) => value);
  return `<section class="course-preview" aria-label="コース予習情報"><div class="course-preview-heading"><b>コース予習</b><span>情報確度 ${preview.confidence}・${preview.confidence === "B" ? "公開案内を基にした暫定候補" : "公開案内のみ"}</span></div>${rows.length ? `<dl>${rows.map(([label, value]) => `<div><dt>${label}</dt><dd>${escapeHtml(value)}</dd></div>`).join("")}</dl>` : `<p>攻略情報は未取得です。現地で確認してください。</p>`}<small>出典：${escapeHtml(preview.sourceName)}。距離・危険範囲は未測定です。</small></section>`;
}

function renderCompactHoleCard(hole) {
  const record = normalizeRoundRecord(hole.roundRecord) ?? {};
  const recommendation = recommendationForPlay(hole);
  const primary = recommendation?.primaryRecommendation;
  const aggressive = recommendation?.aggressiveOption;
  const clubOptions = [...clubData.map((club) => [club.id, club.name]), ["other", "その他"]];
  const resultOptions = [["fw", "FW"], ["left", "左"], ["right", "右"], ["ob-left", "OB左"], ["ob-right", "OB右"], ["other", "その他"]];
  const distance = hole.tees?.[selected.tee]?.distanceYards ?? hole.regularYardage ?? null;
  const savedResult = resultOptions.find(([id]) => id === record.shotResult)?.[1] ?? "";
  const savedSummary = record.recordedAt || record.firstPuttDistance != null
    ? `<span class="compact-saved">保存済み${record.actualClubName ? `：${escapeHtml(record.actualClubName)}` : ""}${savedResult ? ` / ${savedResult}` : ""}${record.firstPuttDistance != null ? ` / 1st ${record.firstPuttDistance}m` : ""}</span>`
    : "";
  const isSaved = Boolean(record.recordedAt) && todayAdjustmentMatchesRecord(hole, record) && !dirtyRecordHoles.has(recordStateKey(hole.holeNumber));
  const displayNumber = isSugiyamaCourse() ? hole.sectionHoleNumber : hole.holeNumber;
  const strategyDisplay = primary
    ? `<div class="compact-primary"><span>${isSugiyamaCourse() ? "安全推奨候補" : "安全推奨"}</span><strong>${primary.club.name}</strong></div>${aggressive ? `<div class="compact-aggressive"><span>攻めるなら</span><strong>${aggressive.club.name}</strong></div>` : ""}`
    : hole.par === 3 ? `<div class="compact-par3"><span>PAR3</span><strong>戦略判定対象外</strong></div>`
      : `<div class="compact-onsite"><span>安全推奨</span><strong>現地判断</strong></div>`;
  return `<article class="compact-hole-card" id="hole-${hole.holeNumber}">
    <header class="compact-hole-header"><div><strong>${displayNumber}</strong><span>${isSugiyamaCourse() ? sectionName(hole.section === "west" ? "out" : "in") : "HOLE"}</span></div><p>PAR ${hole.par ?? "―"}<b>${distance ?? "―"}<small>yd</small></b></p></header>
    <div class="compact-strategy">${strategyDisplay}</div>
    <p class="compact-risk"><b>注意：</b>${escapeHtml(compactRiskText(hole))}</p>
    ${primary?.reasons?.length ? `<ul class="compact-reasons">${primary.reasons.slice(0, 2).map((reason) => `<li>${escapeHtml(reason)}</li>`).join("")}</ul>` : ""}
    ${renderCoursePreview(hole)}
    ${renderHoleReports(hole)}
    <form class="compact-record-form" data-hole="${hole.holeNumber}">
      <div class="compact-input-grid"><label>使用クラブ<select name="actualClub">${compactSelectOptions(clubOptions, record.actualClubId, "選択")}</select></label><label>結果<select name="shotResult">${compactSelectOptions(resultOptions, record.shotResult, "選択")}</select></label><label>1stパット距離<input name="firstPuttDistance" type="number" inputmode="decimal" min="0" step="0.1" value="${inputValue(record.firstPuttDistance)}" placeholder="m" /></label></div>
      <label class="compact-other-club" ${record.actualClubId === "other" ? "" : "hidden"}>その他のクラブ<input name="otherClub" value="${escapeHtml(record.otherClubName ?? "")}" /></label>
      <details class="compact-memo" ${record.resultMemo ? "open" : ""}><summary>メモ${record.resultMemo ? "（入力済み）" : "（任意）"}</summary><textarea name="shotResultMemo" rows="2" placeholder="判断理由や実戦で気づいたこと">${escapeHtml(record.resultMemo ?? "")}</textarea></details>
      <button class="compact-save ${isSaved ? "is-saved" : ""}" type="submit">${isSaved ? "✓ 保存済み" : "このホールを保存"}</button>${savedSummary}
    </form>
    ${renderTodayAdjustment(hole, isSugiyamaCourse() ? null : recommendation)}
  </article>`;
}

function renderStrategy() {
  const isOut = selected.course === "out";
  const min = isOut ? 1 : 10;
  const max = isOut ? 9 : 18;
  const holes = courseData.holes.filter((hole) => hole.holeNumber >= min && hole.holeNumber <= max);
  const nextSide = isOut ? "in" : "out";
  const switchLabel = isOut ? `${sectionName("in")}へ →` : `← ${sectionName("out")}へ`;
  strategyCard.innerHTML = holes.length
    ? `<div class="nine-hole-list">${holes.map(renderCompactHoleCard).join("")}<div class="nine-hole-switch"><button type="button" data-nine-switch="${nextSide}">${switchLabel}</button></div></div>`
    : `<div class="pending-card"><h3>${selected.course.toUpperCase()}</h3><p>このコースのホールデータはまだ登録されていません。</p></div>`;
}

function selectHole(number) {
  selected.hole = Math.min(18, Math.max(1, number));
  selected.course = selected.hole <= 9 ? "out" : "in";
  todayEditMode = false;
  renderSelectors();
  renderStrategy();
}

holeSelector.addEventListener("click", (event) => {
  const button = event.target.closest("[data-hole]");
  if (button) selectHole(Number(button.dataset.hole));
});
courseSelector.addEventListener("click", (event) => {
  const button = event.target.closest("[data-course]");
  if (!button) return;
  selectHole(button.dataset.course === "out" ? 1 : 10);
});
function switchNineHoles(course) {
  selectHole(course === "in" ? 10 : 1);
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      window.scrollTo({ top: Math.max(0, strategyCard.offsetTop - 8), behavior: "auto" });
    });
  });
}
strategyCard.addEventListener("click", (event) => {
  const button = event.target.closest("[data-nine-switch]");
  if (button) switchNineHoles(button.dataset.nineSwitch);
});
coursePicker.addEventListener("change", (event) => {
  const nextCourse = courseCatalog.find((item) => item.id === event.target.value);
  if (!nextCourse) return;
  courseData = nextCourse;
  selected.courseId = nextCourse.id;
  selected.tee = nextCourse.tees[0]?.id ?? "regular";
  selectHole(1);
});
document.querySelector("#settingsButton").addEventListener("click", () => showDeveloperScreen(true));
verificationScreen.addEventListener("click", (event) => {
  if (event.target.closest("#closeVerification")) showDeveloperScreen(true);
  if (event.target.closest("#saveMapApproximate")) { saveMapImport("approximate"); renderVerificationScreen(); }
  if (event.target.closest("#saveMapVerified")) { saveMapImport("verified"); renderVerificationScreen(); }
  if (event.target.closest("#previewOsmGeoJson")) {
    const input = verificationScreen.querySelector("#osmGeoJsonInput");
    osmGeoJsonText = input.value;
    try {
      osmGeoJsonResult = analyzeOsmGeoJson(osmGeoJsonText);
      osmGeoJsonError = null;
    } catch (error) {
      osmGeoJsonResult = null;
      osmGeoJsonError = error instanceof Error ? error.message : "GeoJSONを解析できませんでした。";
    }
    renderVerificationScreen();
  }
});
verificationScreen.addEventListener("change", async (event) => {
  const input = event.target.closest("#mapDataFile");
  if (!input?.files?.[0]) return;
  try {
    mapImportPreview = await buildMapImportPreview(input.files[0]);
    mapImportError = null;
  } catch (error) {
    mapImportPreview = null;
    mapImportError = error instanceof Error ? error.message : "ファイルを読み込めませんでした。";
  }
  renderVerificationScreen();
});
developerScreen.addEventListener("click", async (event) => {
  if (event.target.closest("#closeDeveloper")) showDeveloperScreen(false);
  if (event.target.closest("#openVerification")) showVerificationScreen(true);
  if (event.target.closest("#developerEditToggle")) { editMode = !editMode; renderDeveloperScreen(); }
  const holeButton = event.target.closest("[data-developer-hole]");
  if (holeButton) { selected.hole = Number(holeButton.dataset.developerHole); selected.course = selected.hole <= 9 ? "out" : "in"; editMode = false; renderDeveloperScreen(); }
  if (event.target.closest("#startNewRound") && window.confirm("新しいラウンド履歴を作成し、現在画面の当日条件・使用クラブ・結果・メモをリセットします。開始しますか？")) {
    try {
      await startV4Round();
      editMode = false;
      showDeveloperScreen(false);
      window.scrollTo(0, 0);
    } catch (error) {
      window.alert(`ラウンドを開始できませんでした：${error instanceof Error ? error.message : "保存領域を確認してください。"}`);
      renderDeveloperScreen();
    }
    return;
  }
  if (event.target.closest("#finishV4Round") && window.confirm("現在のラウンドを終了しますか？ 記録は過去ラウンドとして残ります。")) {
    try {
      await finishV4Round();
      renderDeveloperScreen();
      renderV4RoundStatus();
    } catch (error) {
      window.alert(`ラウンドを終了できませんでした：${error instanceof Error ? error.message : "保存領域を確認してください。"}`);
    }
    return;
  }
  if (event.target.closest("#resetRoundInputs") && window.confirm(`${courseData.courseName}の使用クラブ・結果・1stパット距離・メモを全ホール分リセットします。コース戦略と報告原文は削除しません。よろしいですか？`)) {
    try {
      flushPendingReports();
      await reportSaveQueue;
      await resetRoundInputsForCurrentCourse();
      renderDeveloperScreen();
      renderCurrentPlayState();
    } catch (error) {
      window.alert(`ラウンド入力をリセットできませんでした：${error instanceof Error ? error.message : "保存領域を確認してください。"}`);
    }
    return;
  }
  if (event.target.closest("#exportData")) exportCourseData();
});
developerScreen.addEventListener("submit", (event) => {
  if (event.target.id === "addDistanceForm") {
    event.preventDefault();
    const hole = holeByNumber(selected.hole);
    const distanceFromTee = Number(new FormData(event.target).get("distanceFromTee"));
    if (!hole.landingZones.some((zone) => zone.distanceFromTee === distanceFromTee)) {
      hole.landingZones.push(normalizeLandingZone({ distanceFromTee }));
      hole.landingZones.sort((a, b) => a.distanceFromTee - b.distanceFromTee);
      saveLandingZones();
    }
    renderDeveloperScreen();
    return;
  }
  if (event.target.id !== "landingZoneForm") return;
  event.preventDefault();
  const hole = holeByNumber(selected.hole);
  event.target.querySelectorAll(".zone-editor").forEach((fieldset) => {
    const zone = hole.landingZones.find((item) => item.distanceFromTee === Number(fieldset.dataset.distance));
    const get = (name) => fieldset.querySelector(`[name="${name}"]`).value;
    zone.qualityStatus = get("qualityStatus");
    zone.fairwayWidth = nullableNumber(get("fairwayWidth"));
    zone.leftSafeMargin = nullableNumber(get("leftSafeMargin"));
    zone.rightSafeMargin = nullableNumber(get("rightSafeMargin"));
    zone.leftHazardType = get("leftHazardType");
    zone.rightHazardType = get("rightHazardType");
    zone.leftHazardDistance = nullableNumber(get("leftHazardDistance"));
    zone.rightHazardDistance = nullableNumber(get("rightHazardDistance"));
    zone.frontHazardType = get("frontHazardType");
    zone.frontHazardDistance = nullableNumber(get("frontHazardDistance"));
    zone.requiredCarryToClear = nullableNumber(get("requiredCarryToClear"));
    zone.dataSource = get("dataSource") || null;
    zone.notes = get("notes").trim() || null;
  });
  saveLandingZones();
  editMode = false;
  renderDeveloperScreen();
});
developerScreen.addEventListener("change", async (event) => {
  const input = event.target.closest("#importData");
  if (!input?.files?.[0]) return;
  try {
    const result = await importCourseData(input.files[0]);
    await migrateAvailableV3Records();
    backupImportStatus = "success";
    backupImportMessage = `${result.totalHoles}ホール中${result.matchedHoles}ホールを読み込み、実戦記録${result.restoredRoundRecords}件を復元しました。`;
  } catch (error) {
    backupImportStatus = "error";
    backupImportMessage = `読み込みに失敗しました：${error instanceof Error ? error.message : "ファイルを確認してください。"}`;
  }
  renderCurrentPlayState();
  renderDeveloperScreen();
});
teeSelector.addEventListener("click", (event) => {
  const button = event.target.closest("[data-tee]");
  if (!button) return;
  selected.tee = button.dataset.tee;
  renderSelectors();
  renderStrategy();
});
strategyCard.addEventListener("click", (event) => {
  if (event.target.closest("#editToggle")) {
    editMode = !editMode;
    renderStrategy();
  }
});
strategyCard.addEventListener("click", (event) => {
  if (event.target.closest("#openTodayEdit")) { todayEditMode = true; renderStrategy(); }
  if (event.target.closest("#closeTodayEdit")) { todayEditMode = false; renderStrategy(); }
});
strategyCard.addEventListener("submit", async (event) => {
  if (event.target.id === "addDistanceForm") {
    event.preventDefault();
    const hole = holeByNumber(selected.hole);
    const distanceFromTee = Number(new FormData(event.target).get("distanceFromTee"));
    if (!hole.landingZones.some((zone) => zone.distanceFromTee === distanceFromTee)) {
      hole.landingZones.push(normalizeLandingZone({ distanceFromTee }));
      hole.landingZones.sort((a, b) => a.distanceFromTee - b.distanceFromTee);
      saveLandingZones();
    }
    renderStrategy();
    return;
  }
  if (event.target.id !== "landingZoneForm") return;
  event.preventDefault();
  const hole = holeByNumber(selected.hole);
  event.target.querySelectorAll(".zone-editor").forEach((fieldset) => {
    const zone = hole.landingZones.find((item) => item.distanceFromTee === Number(fieldset.dataset.distance));
    // 同名フィールドが複数あるため、各地点のフィールドだけから値を読みます。
    const get = (name) => fieldset.querySelector(`[name="${name}"]`).value;
    zone.qualityStatus = get("qualityStatus");
    zone.fairwayWidth = nullableNumber(get("fairwayWidth"));
    zone.leftSafeMargin = nullableNumber(get("leftSafeMargin"));
    zone.rightSafeMargin = nullableNumber(get("rightSafeMargin"));
    zone.leftHazardType = get("leftHazardType");
    zone.rightHazardType = get("rightHazardType");
    zone.leftHazardDistance = nullableNumber(get("leftHazardDistance"));
    zone.rightHazardDistance = nullableNumber(get("rightHazardDistance"));
    zone.frontHazardType = get("frontHazardType");
    zone.frontHazardDistance = nullableNumber(get("frontHazardDistance"));
    zone.requiredCarryToClear = nullableNumber(get("requiredCarryToClear"));
    zone.dataSource = get("dataSource") || null;
    zone.notes = get("notes").trim() || null;
  });
  saveLandingZones();
  editMode = false;
  renderStrategy();
});
strategyCard.addEventListener("submit", (event) => {
  if (!event.target.matches(".today-adjustment-form, #todayAdjustmentForm")) return;
  event.preventDefault();
  const form = event.target;
  const data = new FormData(form);
  const leftHazardDistance = nullableNumber(data.get("leftHazardDistance"));
  const rightHazardDistance = nullableNumber(data.get("rightHazardDistance"));
  const frontHazardDistance = nullableNumber(data.get("frontHazardDistance"));
  const hole = holeByNumber(Number(form.dataset.hole ?? selected.hole));
  hole.todayAdjustment = {
    windDirection: data.get("windDirection") || null,
    windStrength: data.get("windStrength") || null,
    teePosition: data.get("teePosition") || null,
    teeDistanceOffset: nullableNumber(data.get("teeDistanceOffset")),
    ground: data.get("ground") || null,
    leftHazardDistance,
    rightHazardDistance,
    frontHazardDistance,
    hazards: [["左ハザード", leftHazardDistance], ["右ハザード", rightHazardDistance], ["正面ハザード", frontHazardDistance]].filter(([, distance]) => distance != null).map(([name, distanceYards]) => ({ name, distanceYards })),
    memo: form.querySelector('[name="todayMemo"]').value.trim() || null,
  };
  saveLandingZones();
  markRecordDirty(hole.holeNumber);
  todayEditMode = false;
  renderStrategy();
});
strategyCard.addEventListener("submit", async (event) => {
  if (!event.target.matches(".compact-record-form, #shotRecordForm")) return;
  event.preventDefault();
  const form = event.target;
  const hole = holeByNumber(Number(form.dataset.hole ?? selected.hole));
  const data = new FormData(form);
  const actualClubId = data.get("actualClub") || null;
  const otherClubName = String(data.get("otherClub") ?? "").trim() || null;
  const pre = recommendationForPlay(hole);
  // 杉山は実測ハザードが未登録。既存の当日入力は残し、根拠のない自動再推薦はしません。
  const today = evaluateTodayRecommendation(hole, isSugiyamaCourse() ? null : pre);
  const actualClubName = actualClubId === "other" ? otherClubName || "その他" : clubData.find((club) => club.id === actualClubId)?.name ?? null;
  const previousRecord = normalizeRoundRecord(hole.roundRecord) ?? {};
  hole.roundRecord = {
    ...previousRecord,
    holeNumber: hole.holeNumber,
    par: hole.par,
    distanceYards: hole.tees[selected.tee]?.distanceYards ?? null,
    preRoundPrimaryClub: pre?.primary?.club.id ?? null,
    preRoundSecondaryClub: pre?.secondary?.club.id ?? null,
    preRoundAggressiveClub: pre?.aggressiveOption?.club.id ?? null,
    todayConditions: normalizedTodayAdjustment(hole),
    todayPrimaryClub: today.primary?.club.id ?? null,
    todayEffectiveDistance: today.primary?.effectiveDistance ?? null,
    adjustedHazards: today.hazards ?? [],
    adjustedHoleDistance: today.adjustedHoleDistance ?? hole.tees[selected.tee]?.distanceYards ?? null,
    actualClubId,
    actualClubName,
    otherClubName,
    shotResult: data.get("shotResult") || null,
    preRoundMatched: pre?.primary && actualClubId && actualClubId !== "other" ? actualClubId === pre.primary.club.id : null,
    todayMatched: today.primary && actualClubId && actualClubId !== "other" ? actualClubId === today.primary.club.id : null,
    memo: normalizedTodayAdjustment(hole).memo,
    resultMemo: String(data.get("shotResultMemo") ?? "").trim() || null,
    firstPuttDistance: nullableNumber(data.get("firstPuttDistance")),
    recordedAt: new Date().toISOString(),
  };
  saveLandingZones();
  try {
    await syncV3RecordToActiveV4(hole);
  } catch (error) {
    window.alert(`v3には保存しましたが、ラウンド履歴への同期に失敗しました：${error instanceof Error ? error.message : "IndexedDBを確認してください。"}`);
  }
  dirtyRecordHoles.delete(recordStateKey(hole.holeNumber));
  renderStrategy();
});
strategyCard.addEventListener("change", (event) => {
  if (event.target.name !== "actualClub") return;
  const form = event.target.closest(".compact-record-form");
  const other = form?.querySelector(".compact-other-club");
  if (other) other.hidden = event.target.value !== "other";
});
strategyCard.addEventListener("input", (event) => {
  const reportInput = event.target.closest(".hole-report-editor textarea[data-report-type]");
  if (reportInput) {
    const holeNumber = Number(reportInput.dataset.hole);
    const type = reportInput.dataset.reportType;
    const round = v4State.activeRound;
    if (!round || round.courseId !== courseData.id) return;
    setReportSaveStatus(holeNumber, type, "typing", "入力中");
    queueReportSave({ roundId: round.roundId, courseId: round.courseId, holeNumber, type, text: reportInput.value });
    return;
  }
  const form = event.target.closest(".compact-record-form, .today-adjustment-form");
  if (form?.dataset.hole) markRecordDirty(Number(form.dataset.hole));
});
strategyCard.addEventListener("focusout", (event) => {
  const reportInput = event.target.closest(".hole-report-editor textarea[data-report-type]");
  if (!reportInput || !v4State.activeRound) return;
  flushReportSave(`${v4State.activeRound.roundId}:${Number(reportInput.dataset.hole)}:${reportInput.dataset.reportType}`);
});
strategyCard.addEventListener("change", (event) => {
  const form = event.target.closest(".compact-record-form, .today-adjustment-form");
  if (form?.dataset.hole) markRecordDirty(Number(form.dataset.hole));
});
strategyCard.addEventListener("click", (event) => {
  if (event.target.closest("#exportData")) exportCourseData();
});
strategyCard.addEventListener("change", async (event) => {
  const input = event.target.closest("#importData");
  if (!input?.files?.[0]) return;
  try {
    const result = await importCourseData(input.files[0]);
    await migrateAvailableV3Records();
    backupImportStatus = "success";
    backupImportMessage = `${result.totalHoles}ホール中${result.matchedHoles}ホールを読み込み、実戦記録${result.restoredRoundRecords}件を復元しました。`;
    renderCurrentPlayState();
  } catch (error) {
    backupImportStatus = "error";
    backupImportMessage = `読み込みに失敗しました：${error instanceof Error ? error.message : "ファイルを確認してください。"}`;
    window.alert(backupImportMessage);
  }
});
document.querySelector("#previousButton").addEventListener("click", () => selectHole(selected.hole - 1));
document.querySelector("#nextButton").addEventListener("click", () => selectHole(selected.hole + 1));

courseCatalog.forEach((course) => loadSavedLandingZones(course));
renderSelectors();
renderStrategy();
initializeV4Storage().then(() => {
  if (!developerScreen.hidden) renderDeveloperScreen();
  else renderStrategy();
});
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") flushPendingReports();
});
window.addEventListener("pagehide", flushPendingReports);
