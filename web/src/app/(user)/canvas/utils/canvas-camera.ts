/**
 * Professional cinematography prompt library for the Camera Control panel.
 *
 * The shape of the output prompt follows the same "duty-structured" pattern
 * we're using across the project:
 *   1) Task context: "these are camera / lens / exposure parameters"
 *   2) Camera body profile: sensor, color science, overall look
 *   3) Lens profile: optical character, bokeh shape, flare behaviour
 *   4) Focal length: perspective (wide / normal / tele) + framing implications
 *   5) Aperture: depth-of-field + bokeh strength
 *   6) Guardrails: do not render the camera inside the frame
 *
 * The resulting string is inserted into the user's generation prompt, so
 * every fragment is short and comma-joinable.
 */

import type { CameraControlOptions } from "../types";

export interface CameraProfile {
  id: string;
  label: string;
  zhName: string;
  shortTag: string;
  /** How this specific camera body looks, independent of lens/focal. */
  profilePrompt: string;
  /** Visual theme keys consumed by the UI to differentiate each body. */
  bodyColor: string;
  accentColor: string;
  /** One-line 使用场景 shown in the hover tooltip. */
  useCase: string;
  /** Short description displayed above the use case in tooltip. */
  description: string;
}

export interface LensProfile {
  id: string;
  label: string;
  zhName: string;
  shortTag: string;
  /** Character of the lens: bokeh shape, contrast, flare, sharpness tone. */
  profilePrompt: string;
  lensColor: string;
  ringColor: string;
  useCase: string;
  description: string;
}

export const CAMERA_PROFILES: CameraProfile[] = [
  {
    id: 'hasselblad_h6d_100c',
    label: 'Hasselblad H6D-100c',
    zhName: '哈苏 H6D-100c',
    shortTag: 'Hasselblad H6D-100c',
    profilePrompt:
      'shot on Hasselblad H6D-100c, 100MP medium format sensor, legendary Hasselblad natural color science, extraordinary tonal gradation, silky highlight rolloff, ultra-fine detail retention, premium commercial still photography look',
    bodyColor: '#2e2e2e', accentColor: '#f0a030',
    description: '100MP 中画幅，哈苏自然色彩，顶级商业摄影机。',
    useCase: '时尚大片、奢侈品广告、高端人像',
  },
  {
    id: 'phase_one_xf_iq4',
    label: 'Phase One XF IQ4',
    zhName: '飞思 XF IQ4',
    shortTag: 'Phase One XF IQ4',
    profilePrompt:
      'shot on Phase One XF IQ4 150MP, 150-megapixel medium format, unrivaled resolution and dynamic range, ultra-smooth tonal transitions, fashion and luxury advertising standard',
    bodyColor: '#232323', accentColor: '#4d90d0',
    description: '150MP 中画幅，极致分辨率，时尚与奢侈品广告标配。',
    useCase: '高端时尚、珠宝、超大幅输出',
  },
  {
    id: 'canon_eos_r5',
    label: 'Canon EOS R5',
    zhName: '佳能 EOS R5',
    shortTag: 'Canon EOS R5',
    profilePrompt:
      'shot on Canon EOS R5, 45MP full-frame sensor, Canon color science with warm skin tones, clean modern digital detail, versatile commercial photography look',
    bodyColor: '#2d1f1f', accentColor: '#e03030',
    description: '45MP 全画幅，佳能暖调肤色，商业摄影主流。',
    useCase: '商业人像、电商、产品',
  },
  {
    id: 'sony_a7r5',
    label: 'Sony A7R V',
    zhName: '索尼 A7R V',
    shortTag: 'Sony A7R V',
    profilePrompt:
      'shot on Sony A7R V, 61MP full-frame sensor, exceptional micro-contrast and detail, neutral accurate color, crisp professional still photography look',
    bodyColor: '#2a2a2a', accentColor: '#f07800',
    description: '61MP 全画幅，微反差细腻，专业静态摄影。',
    useCase: '风光、产品、细节纹理',
  },
  {
    id: 'nikon_z9',
    label: 'Nikon Z9',
    zhName: '尼康 Z9',
    shortTag: 'Nikon Z9',
    profilePrompt:
      'shot on Nikon Z9, 45.7MP full-frame stacked sensor, natural Nikon color rendering, outstanding dynamic range, reliable pro photography look',
    bodyColor: '#26262b', accentColor: '#f5d010',
    description: '45.7MP 全画幅，动态范围出色，全能旗舰。',
    useCase: '商业、体育、纪实',
  },
  {
    id: 'fujifilm_gfx100_ii',
    label: 'Fujifilm GFX100 II',
    zhName: '富士 GFX100 II',
    shortTag: 'Fujifilm GFX100 II',
    profilePrompt:
      'shot on Fujifilm GFX100 II, 102MP medium format, Fujifilm color science with film-like tonal character, rich smooth gradation, fine-art commercial look',
    bodyColor: '#2b2b2b', accentColor: '#e02030',
    description: '102MP 中画幅，胶片感色调，性价比中画幅。',
    useCase: '艺术人像、胶片感商业片',
  },
  {
    id: 'leica_sl2',
    label: 'Leica SL2',
    zhName: '徕卡 SL2',
    shortTag: 'Leica SL2',
    profilePrompt:
      'shot on Leica SL2, 47MP full-frame sensor, Leica color science, characterful micro-contrast, subtle 3D pop, premium editorial photography look',
    bodyColor: '#2a2a2a', accentColor: '#d03030',
    description: '47MP 全画幅，徕卡色彩，独特微反差。',
    useCase: '高级编辑、杂志、人文',
  },
  {
    id: 'canon_5d4',
    label: 'Canon 5D Mark IV',
    zhName: '佳能 5D Mark IV',
    shortTag: 'Canon 5D Mark IV',
    profilePrompt:
      'shot on Canon 5D Mark IV, 30MP full-frame sensor, classic Canon skin tones, reliable balanced rendering, timeless commercial photography look',
    bodyColor: '#2d2420', accentColor: '#e0a030',
    description: '30MP 全画幅，经典佳能肤色，稳定可靠。',
    useCase: '婚礼、商业、标准人像',
  },
  {
    id: 'panavision_dxl2',
    label: 'Panavision DXL2',
    zhName: '潘那维申 DXL2',
    shortTag: 'Panavision DXL2',
    profilePrompt:
      'shot on Panavision DXL2 with Panavision DXL color science, large-format Monstro 8K VV sensor, signature organic highlight rolloff, rich filmic texture, premium modern cinema look',
    bodyColor: '#2a2a2a', accentColor: '#e2a84f',
    description: '好莱坞顶级院线电影机，8K 大画幅传感器，质感油润。',
    useCase: '剧情长片、奢华广告、顶级商业片',
  },
  {
    id: 'arri_alexa_mini_lf',
    label: 'ARRI Alexa Mini LF',
    zhName: '阿莱 Mini LF',
    shortTag: 'ARRI Alexa Mini LF',
    profilePrompt:
      'shot on ARRI Alexa Mini LF with ARRI Wide Gamut color science, ALEV III large-format sensor, gorgeous skin-tone rendering, buttery highlight rolloff, industry-standard feature-film look',
    bodyColor: '#3a3a3a', accentColor: '#d4d4d4',
    description: '行业基准院线电影机，肤色渲染公认最佳。',
    useCase: '剧情片、人像叙事、品牌广告',
  },
  {
    id: 'red_komodo_6k',
    label: 'RED Komodo 6K',
    zhName: 'RED 科莫多 6K',
    shortTag: 'RED Komodo 6K',
    profilePrompt:
      'shot on RED Komodo 6K with RED IPP2 color pipeline, Super35 global-shutter sensor, crisp modern digital detail, clean shadows, crisp action-movie look',
    bodyColor: '#8b2b2b', accentColor: '#ff3b3b',
    description: '紧凑全局快门 6K，无果冻效应，动作片首选。',
    useCase: '动作片、FPV、穿越机、无人机',
  },
  {
    id: 'red_v_raptor_8k',
    label: 'RED V-Raptor 8K',
    zhName: 'RED V-Raptor 8K',
    shortTag: 'RED V-Raptor 8K',
    profilePrompt:
      'shot on RED V-Raptor 8K VV, RED IPP2 color pipeline, 8K Vista Vision sensor, razor-sharp resolution, vivid yet natural color',
    bodyColor: '#701f1f', accentColor: '#ff5555',
    description: 'RED 旗舰 8K Vista Vision，极致清晰度。',
    useCase: '科幻大片、高分辨率 VFX 场景',
  },
  {
    id: 'sony_venice_2',
    label: 'Sony Venice 2',
    zhName: '索尼 Venice 2',
    shortTag: 'Sony Venice 2',
    profilePrompt:
      'shot on Sony Venice 2 with Sony S-Gamut3.Cine / S-Log3, dual native ISO full-frame cinema sensor, clean shadows, highly refined modern color science',
    bodyColor: '#2d3a4d', accentColor: '#4d90d0',
    description: '全画幅双原生 ISO，弱光表现极佳。',
    useCase: '高端广告、纪录片、夜景戏剧',
  },
  {
    id: 'sony_fx6',
    label: 'Sony FX6',
    zhName: '索尼 FX6',
    shortTag: 'Sony FX6',
    profilePrompt:
      'shot on Sony FX6, Sony Venice-derived color science, full-frame cinema sensor, clean low-light performance, documentary-friendly modern look',
    bodyColor: '#2d2d36', accentColor: '#ff9000',
    description: '轻量全画幅 Cinema Line，手持纪录片常用。',
    useCase: '纪录片、单兵采访、轻量剧情',
  },
  {
    id: 'blackmagic_ursa_12k',
    label: 'Blackmagic URSA 12K',
    zhName: '黑魔法 URSA 12K',
    shortTag: 'Blackmagic URSA 12K',
    profilePrompt:
      'shot on Blackmagic URSA Cine 12K with Blackmagic Generation 5 color science, Super35 12K sensor, rich filmic tones, indie-cinema aesthetic',
    bodyColor: '#2e2e2e', accentColor: '#ffb820',
    description: '独立电影人宠儿，12K 高分辨率性价比机。',
    useCase: '独立电影、音乐短片、实验影像',
  },
  {
    id: 'canon_c500_mk2',
    label: 'Canon C500 Mk II',
    zhName: '佳能 C500 Mk II',
    shortTag: 'Canon C500 Mk II',
    profilePrompt:
      'shot on Canon C500 Mark II with Canon Cinema Gamut, full-frame cinema sensor, warm natural skin tones, premium broadcast and feature-film character',
    bodyColor: '#332a22', accentColor: '#e8c070',
    description: '佳能色彩科学，暖调肤色，广播级电影机。',
    useCase: '广告、电视剧、婚礼电影',
  },];

export const LENS_PROFILES: LensProfile[] = [
  {
    id: 'zeiss_otus_55',
    label: 'Zeiss Otus 55mm',
    zhName: '蔡司 Otus 55mm',
    shortTag: 'Zeiss Otus 55mm',
    profilePrompt:
      'Zeiss Otus 55mm f/1.4 lens, apochromatic perfection, extreme sharpness wide open, neutral color, smooth creamy bokeh, reference-grade portrait rendering',
    lensColor: '#1e1e22', ringColor: '#f0c040',
    description: '蔡司顶级定焦，全开锐利，参考级画质。',
    useCase: '人像、静物、极致画质',
  },
  {
    id: 'canon_rf_50_12l',
    label: 'Canon RF 50mm f/1.2L',
    zhName: '佳能 RF 50mm f/1.2L',
    shortTag: 'Canon RF 50mm f/1.2L',
    profilePrompt:
      'Canon RF 50mm f/1.2L lens, ultra-wide aperture, dreamy soft bokeh, warm natural skin rendering, gentle contrast, luxury portrait look',
    lensColor: '#2d1f1f', ringColor: '#e03030',
    description: '佳能大光圈定焦，梦幻虚化，奢华人像。',
    useCase: '人像、婚礼、时尚',
  },
  {
    id: 'sony_fe_50_12gm',
    label: 'Sony FE 50mm f/1.2 GM',
    zhName: '索尼 FE 50mm f/1.2 GM',
    shortTag: 'Sony FE 50mm f/1.2 GM',
    profilePrompt:
      'Sony FE 50mm f/1.2 GM lens, creamy rounded bokeh, high resolution wide open, neutral modern rendering, professional portrait look',
    lensColor: '#26262a', ringColor: '#f07800',
    description: '索尼 G Master 定焦，圆形虚化，全开高解析。',
    useCase: '人像、商业、环境肖像',
  },
  {
    id: 'nikon_z_58_noct',
    label: 'Nikon Z 58mm f/0.95 Noct',
    zhName: '尼康 Z 58mm f/0.95 Noct',
    shortTag: 'Nikon Z 58mm f/0.95 Noct',
    profilePrompt:
      'Nikon Z 58mm f/0.95 Noct lens, extreme aperture, dreamy bokeh, pinpoint sharpness, luminous rendering, cinematic still photography look',
    lensColor: '#1f1f26', ringColor: '#f5d010',
    description: '尼康夜神，f/0.95 极致光圈，梦幻通透。',
    useCase: '夜景人像、氛围、艺术',
  },
  {
    id: 'sigma_art_35',
    label: 'Sigma Art 35mm f/1.4',
    zhName: '适马 Art 35mm f/1.4',
    shortTag: 'Sigma Art 35mm f/1.4',
    profilePrompt:
      'Sigma Art 35mm f/1.4 lens, high resolution, crisp micro-contrast, slightly cool neutral rendering, versatile editorial look',
    lensColor: '#2b2b2b', ringColor: '#60b0e0',
    description: '适马 Art 系列，高解析微反差，编辑级画质。',
    useCase: '环境人像、街拍、编辑',
  },
  {
    id: 'leica_summilux_50',
    label: 'Leica Summilux 50mm f/1.4',
    zhName: '徕卡 Summilux 50mm f/1.4',
    shortTag: 'Leica Summilux 50mm f/1.4',
    profilePrompt:
      'Leica Summilux 50mm f/1.4 lens, distinctive Leica character, gentle glow wide open, rich color, classic reportage and portrait rendering',
    lensColor: '#2a2a2a', ringColor: '#d03030',
    description: '徕卡经典，全开微光晕，色彩浓郁。',
    useCase: '人文、纪实、经典人像',
  },
  {
    id: 'hasselblad_xcd_90',
    label: 'Hasselblad XCD 90mm f/3.2',
    zhName: '哈苏 XCD 90mm f/3.2',
    shortTag: 'Hasselblad XCD 90mm f/3.2',
    profilePrompt:
      'Hasselblad XCD 90mm f/3.2 lens, medium format portrait lens, smooth falloff, exquisite detail, elegant bokeh, premium fashion look',
    lensColor: '#2b2b2b', ringColor: '#f0a030',
    description: '哈苏中画幅人像镜，层次细腻，优雅虚化。',
    useCase: '时尚、高端人像、中画幅',
  },
  {
    id: 'fujifilm_gf_110',
    label: 'Fujifilm GF 110mm f/2',
    zhName: '富士 GF 110mm f/2',
    shortTag: 'Fujifilm GF 110mm f/2',
    profilePrompt:
      'Fujifilm GF 110mm f/2 lens, medium format portrait lens, soft creamy bokeh, fine tonal gradation, flattering skin rendering',
    lensColor: '#282828', ringColor: '#e02030',
    description: '富士中画幅人像镜，柔和虚化，讨喜肤色。',
    useCase: '艺术人像、胶片感商业',
  },
  {
    id: 'arri_signature_prime',
    label: 'ARRI Signature Prime',
    zhName: '阿莱大师定焦',
    shortTag: 'ARRI Signature Prime',
    profilePrompt:
      'ARRI Signature Prime lens, large-format coverage, creamy organic bokeh, gentle contrast, smooth highlight rolloff, soft flattering flares',
    lensColor: '#2a2a2a', ringColor: '#c4a060',
    description: '顶级大画幅定焦头，奶油虚化，温润对比。',
    useCase: '人物叙事、顶级商业片',
  },
  {
    id: 'cooke_s7i',
    label: 'Cooke S7/i',
    zhName: '库克 S7/i',
    shortTag: 'Cooke S7/i',
    profilePrompt:
      'Cooke S7/i lens, legendary "Cooke Look", warm color bias, gentle contrast, soft rounded bokeh, classic flattering skin rendering',
    lensColor: '#26231d', ringColor: '#d0a060',
    description: '传奇「Cooke Look」，暖调偏红，讨喜肤色。',
    useCase: '古典人像、时代感叙事',
  },
  {
    id: 'zeiss_supreme_prime',
    label: 'Zeiss Supreme Prime',
    zhName: '蔡司至尊定焦',
    shortTag: 'Zeiss Supreme Prime',
    profilePrompt:
      'Zeiss Supreme Prime lens, neutral modern color, high micro-contrast, sharp yet refined detail, clean bokeh with subtle cat-eye near edges',
    lensColor: '#1e1e22', ringColor: '#4d90d0',
    description: '中性现代色彩，微反差锐利而不硬。',
    useCase: '科技感广告、现代剧情',
  },
  {
    id: 'canon_sumire_prime',
    label: 'Canon Sumire Prime',
    zhName: '佳能 Sumire 定焦',
    shortTag: 'Canon Sumire Prime',
    profilePrompt:
      'Canon Sumire Prime lens, soft organic character, warm gentle color rendering, dreamy rounded bokeh, cinematic softness for portraits',
    lensColor: '#2c241c', ringColor: '#e0b070',
    description: '柔和梦幻肤色镜，暖调柔焦。',
    useCase: '爱情片、梦境、人物特写',
  },
  {
    id: 'anamorphic_cooke',
    label: 'Anamorphic (Cooke)',
    zhName: 'Cooke 变形宽银幕',
    shortTag: 'Cooke Anamorphic',
    profilePrompt:
      'Cooke anamorphic lens, oval bokeh, horizontal blue streaks for flares, wide cinematic framing, subtle focus roll-off, 2.39:1 anamorphic cinematic feel',
    lensColor: '#1a1a24', ringColor: '#6a9ed6',
    description: '宽银幕变形镜，椭圆虚化 + 水平蓝色光晕。',
    useCase: '科幻大片、太空戏、夜戏',
  },
  {
    id: 'anamorphic_atlas',
    label: 'Anamorphic (Atlas)',
    zhName: 'Atlas Orion 变形',
    shortTag: 'Atlas Orion Anamorphic',
    profilePrompt:
      'Atlas Orion anamorphic lens, oval bokeh, cyan horizontal flares, modern anamorphic look with clean center and subtle edge blur',
    lensColor: '#1b2228', ringColor: '#40c0e0',
    description: '现代变形镜，青色光晕，中心清晰边缘柔。',
    useCase: '音乐 MV、风格化广告',
  },
  {
    id: 'vintage_leica_r',
    label: 'Vintage Leica R',
    zhName: '徕卡 R 老镜',
    shortTag: 'Vintage Leica R',
    profilePrompt:
      'vintage Leica R prime lens, rich color saturation, slight glow on highlights, slightly soft edges, nostalgic 1970s-80s cinema character',
    lensColor: '#3a2f1f', ringColor: '#d04040',
    description: '上世纪老镜，高光微透溢，复古怀旧味。',
    useCase: '年代戏、怀旧 MV、文艺片',
  },
  {
    id: 'macro_100mm',
    label: 'Macro 100mm',
    zhName: '100mm 微距',
    shortTag: 'Macro 100mm',
    profilePrompt:
      'macro 100mm prime lens, extremely shallow depth of field, razor-thin focus plane, smooth creamy bokeh, detail-rich close-up rendering',
    lensColor: '#1f1f1f', ringColor: '#60d090',
    description: '微距特写专用，细节惊人，景深极浅。',
    useCase: '美食广告、珠宝、昆虫、细节',
  },];

export const FOCAL_LENGTHS = [14, 18, 24, 35, 40, 50, 65, 85, 100, 135, 200] as const;
export const APERTURES = [1.2, 1.4, 1.8, 2, 2.8, 4, 5.6, 8, 11, 16] as const;

export type FocalLengthValue = (typeof FOCAL_LENGTHS)[number];
export type ApertureValue = (typeof APERTURES)[number];

/** Short Chinese labels and tooltip snippets for focal lengths. */
export const FOCAL_LENGTH_META: Record<number, { zhName: string; description: string; useCase: string }> = {
  14: { zhName: '超广角', description: '14mm 极致广角，空间被极度拉伸', useCase: '建筑内景、风景全景、沉浸视角' },
  18: { zhName: '超广角', description: '18mm 超广角，强烈空间纵深', useCase: '街头摄影、室内、建筑' },
  24: { zhName: '广角', description: '24mm 广角，环境感强烈', useCase: '风光、大场面、新闻纪实' },
  35: { zhName: '小广角', description: '35mm 经典叙事焦段，接近人眼', useCase: '纪实、人物环境叙事' },
  40: { zhName: '准标准', description: '40mm 准标准，构图平衡', useCase: '人像叙事、文艺片' },
  50: { zhName: '标准', description: '50mm 标准，空间感自然', useCase: '人像、日常、街拍' },
  65: { zhName: '中焦', description: '65mm 中焦，轻微压缩，讨喜肤色', useCase: '半身人像、对话戏' },
  85: { zhName: '中长焦', description: '85mm 经典人像焦段', useCase: '特写人像、婚礼' },
  100: { zhName: '长焦', description: '100mm 长焦，背景压缩明显', useCase: '特写、微距、体育' },
  135: { zhName: '长焦', description: '135mm 电影专用长焦', useCase: '剧情特写、舞台' },
  200: { zhName: '超长焦', description: '200mm 超长焦，极致背景压缩', useCase: '体育、野生动物、戏剧感特写' },
};

/** Short Chinese labels and tooltip snippets for apertures. */
export const APERTURE_META: Record<number, { zhName: string; description: string; useCase: string }> = {
  1.2: { zhName: '大光圈', description: 'f/1.2 虚化极致，景深刀削般薄', useCase: '梦幻人像、高光溢出效果' },
  1.4: { zhName: '大光圈', description: 'f/1.4 强烈虚化，电影感十足', useCase: '夜景人像、暗光' },
  1.8: { zhName: '大光圈', description: 'f/1.8 明显背景虚化', useCase: '半身人像、街头弱光' },
  2: { zhName: '大光圈', description: 'f/2 柔和虚化与充足锐度', useCase: '人像、文艺日常' },
  2.8: { zhName: '大光圈', description: 'f/2.8 景深适中、虚化柔和', useCase: '群像、叙事' },
  4: { zhName: '中光圈', description: 'f/4 主体清晰，背景有轻微虚化', useCase: '群像、婚礼、电视剧' },
  5.6: { zhName: '中光圈', description: 'f/5.6 背景可辨，环境感强', useCase: '纪实、日常、小品' },
  8: { zhName: '小光圈', description: 'f/8 画质最佳区，前后皆清晰', useCase: '风光、建筑、全景' },
  11: { zhName: '小光圈', description: 'f/11 超大景深，几乎全清晰', useCase: '大场景、产品摆拍' },
  16: { zhName: '小光圈', description: 'f/16 星芒出现，需高光源', useCase: '日光风光、星芒特效' },
};

/** Describe the perspective implication of a given focal length (mm). */
export function describeFocalLength(mm: number): string {
  if (mm <= 16) return `${mm}mm ultra-wide-angle perspective, strong spatial depth, pronounced edge distortion, immersive wide coverage`;
  if (mm <= 24) return `${mm}mm wide-angle perspective, exaggerated depth, strong foreground/background separation, environment-forward framing`;
  if (mm <= 35) return `${mm}mm slight-wide cinematic perspective, natural environmental context, balanced depth, classic story-telling framing`;
  if (mm <= 50) return `${mm}mm standard/normal perspective, close to natural human eye perspective, neutral spatial compression, flattering portrait framing`;
  if (mm <= 85) return `${mm}mm short-telephoto portrait perspective, mild background compression, flattering facial rendering, subject isolation`;
  if (mm <= 135) return `${mm}mm telephoto perspective, moderate compression, strong subject isolation from background, cinematic close-up`;
  return `${mm}mm long-telephoto perspective, strong background compression, highly isolated subject on compressed flat background, powerful dramatic framing`;
}

/** Describe depth-of-field and bokeh strength implied by an aperture value. */
export function describeAperture(f: number): string {
  if (f <= 1.4) return `shot wide open at f/${f}, extremely shallow depth of field, strong creamy bokeh, razor-thin focus plane, dreamy background separation`;
  if (f <= 2) return `shot at f/${f}, very shallow depth of field, smooth cinematic bokeh, clear subject-from-background separation`;
  if (f <= 2.8) return `shot at f/${f}, shallow depth of field, soft bokeh, natural subject isolation`;
  if (f <= 4) return `shot at f/${f}, moderate depth of field, gentle falloff, clean background blur without over-smoothing`;
  if (f <= 5.6) return `shot at f/${f}, balanced depth of field, background retains context while subject remains clearly in focus`;
  if (f <= 8) return `shot at f/${f}, wide depth of field, environment and subject both sharp, documentary / landscape style`;
  return `shot at f/${f}, very wide depth of field, extensive sharpness from foreground to background, wide-open environmental feel`;
}

export function applyCameraPrompt(prompt: string, control?: CameraControlOptions): string {
  if (!control?.enabled) return prompt;
  const camera = CAMERA_PROFILES.find((item) => item.id === control.camera) ?? CAMERA_PROFILES[0];
  const lens = LENS_PROFILES.find((item) => item.id === control.lens) ?? LENS_PROFILES[0];
  const cameraPrompt = [
    'the following parameters describe the virtual camera, lens, and exposure used to render this image — they are camera direction, NOT objects to add inside the frame, do not add any physical camera, lens, tripod, viewfinder, or photography equipment into the image',
    camera.profilePrompt,
    lens.profilePrompt,
    describeFocalLength(control.focalLength),
    describeAperture(control.aperture),
    'keep the subjects, scene, and action unchanged — apply these as optical and sensor characteristics only',
    '[camera body: ' + camera.shortTag + ' · lens: ' + lens.shortTag + ' · focal: ' + control.focalLength + 'mm · aperture: f/' + control.aperture + ']',
  ].join(', ');
  return prompt ? prompt + ', ' + cameraPrompt : cameraPrompt;
}
