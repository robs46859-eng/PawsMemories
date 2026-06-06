import { Album, Creation, StyleType, BackgroundType } from "./types";

export const DEFAULT_ALBUMS: Album[] = [
  {
    id: "album-bailey",
    name: "First Year: Bailey",
    itemCount: 12,
    imageUrl: "https://lh3.googleusercontent.com/aida-public/AB6AXuArSlWVwErnEbnk2aLPVkLPEEjldq0RTpdNmxIKDnsr0jldrmnxQNzO3oFoth-EUF5L-ve0PungeT2kbTWV9-HqepD_bMYQPybtGibaXw2_Oynq9OsXFAwTWDOyUKoHw9Occ-hDeYWecm5UiTBecp1pJ8HG4McquL-zeNdtxaL1BawQ0LiwU57VOsNZsHoHfR7gc1QlaJiH__hJaBqbICJSRdSQRABSJF0AdGyitxXO2XFVPFfAuO7ONqFyTAln4VgRkvPKqveYbmU"
  },
  {
    id: "album-summer",
    name: "Summer Adventures",
    itemCount: 42,
    imageUrl: "https://lh3.googleusercontent.com/aida-public/AB6AXuBpepogeE9ufZ0XZMSpjfKeBawFEB3Qmx49SD1PgwI63lTVz1bW6wvysHa4fmtw4xd1G00jobdOZWmLem87ErgeS4Imv7DsgxgkWKeLcTZwHyiZ_PujCCuSTB345-TjQsds37FDjLmyFkORJoKl6Wu6JHkZO6R1HT_0OuZRHoAz8ecD2Wwc74UsqsYkv7MvrzjsJw-jaJxIkDjQlJHoozAYlh9SFBgKrQ52yXgIXi84m-1mHogWGi8hmVSJPKxmbT5rKZmEgsPp6Mw"
  }
];

export const DEFAULT_CREATIONS: Creation[] = [
  {
    id: 101 as any,
    name: "Randy in Paris",
    style: "Clay",
    background: "Paris",
    imageUrl: "https://lh3.googleusercontent.com/aida-public/AB6AXuBU0nUa1m6O8-EVOuohKwONaRwJZZ1gEa5tLTsM6Pk1OPKho05x71b_umVngODZv7RWo73hOOvU9Pu2yXKJeirbxWxwhUK0Oc8ZFW0V8ZtACgsRSPZMsMbEYEEAO1esiiTpH2zeweZ3QKaShDtccGyScYK3DPYrRmCO8dvSv0zEfSO0vQfPknP_CW52xEaWsC4OY5-40p1XpbQMAuCeo0OUJO_pV-DEwfFkOxaCgZedlpRMbhqAEHqAtwegofQrEhqucTjtQ2OleIE",
    createdAt: "Just now"
  },
  {
    id: 102 as any,
    name: "City of Brotherly Love",
    style: "Clay",
    background: "Rocky",
    imageUrl: "https://lh3.googleusercontent.com/aida/AP1WRLspAs6gAFb2pnpaVX6wcMLvr9o9n3oSE2QFQ2dTFyGxt_HBWbEYLDPj03M_9ZQ1fUm4TnfRYh0PeApgJZ2AGqbRdh1sv9_zZc6O1Z_2K6TS0Y3pXN3M9wGqtt7Dh5FnYaQNj0-HQ20O1ncRPGOjTHWhWj8817xOX71J2boQaFoxsJqqc4SZ3XDZ-gMCCQju26NPYT2d1qfjSYtikKrW1x4abnGrSDW_BDAYmhGFlm2aO349_5tBSXO7_CA",
    createdAt: "2 hours ago"
  },
  {
    id: 103 as any,
    name: "Cabin in the Woods",
    style: "Realistic",
    background: "Cabin",
    imageUrl: "https://lh3.googleusercontent.com/aida/AP1WRLtFDVEbGliaP7_evzZN_0TExPZntgmOewmauFKbkzvCbsDtKQs6KG-2t6XJ2X111LgZJF1OEymMFPWvAmWawCw-BCq6LT56LCOMv1teoRQytKnceBBh9acShCALXBygU3f_ABu8p4jiWEJVExClrbt0bTGdcCQ6GxFLGP4wYdtYKWhbchG9EG7JxIw39ErS7Lal4ujgb8uz8bxQOr-4H1dKF26Fv2zKJ4DWGHaAF7N7C4clV0ba9n8zADQ",
    createdAt: "Yesterday"
  },
  {
    id: 104 as any,
    name: "Randy at the Canyon",
    style: "Clay",
    background: "Canyon",
    imageUrl: "https://lh3.googleusercontent.com/aida/AP1WRLuMUevcjZpP-AN97I_CA6dOQYEMS0BevxX3U39ALuZBdr-amMVOAtfxg8xCDxKyqZaseVEV-unjiFTjJh3qvOeeJK_FEcahmc-CSgTOIEsW_C9-BNmA7cgFVAjjQTQW0l1qQNz2RYiP8fzGVMjSgv3FD75s1qC_ghJQ5_sKyBUcPn7Gt74S_qwQy21Mq7ObaMtDVUR3Joq0QE0DwBDmKXXRXS21S-v6gRkS_EAKEwhLJiVOuOIm8xWZVQ",
    createdAt: "2 days ago"
  },
  {
    id: 105 as any,
    name: "Regal Portrait: Cooper",
    style: "Realistic",
    background: "Meadow",
    imageUrl: "https://lh3.googleusercontent.com/aida-public/AB6AXuB8ObbseD9WagQBXRMd7E8BZ9RKHCgeVXiTKIOxDJMzlQsW7PyFS-UBTPelIFo5QDRzArLs-4-4Oy6SJRj96hu8uVRnQnCBEX1QpUj4KkwViPiT2O6z7A8hCU1m1tGqzsbjfqwTtmb-rdCuYzWTIV3knQxTGdj1wOIy_BZnirVnKurbIwHKukbwAZoLNP71iCjzmKKELvLlJFKabzz3CT54bzle2VywswLksCtnmOWoThBAC3PtfJYhh--0wQssrh3QDfwRSZgeL7o",
    createdAt: "Yesterday"
  },
  {
    id: 106 as any,
    name: "Dreamscape: Luna",
    style: "Artistic",
    background: "Meadow",
    imageUrl: "https://lh3.googleusercontent.com/aida-public/AB6AXuAUfElb0IF7JgzlF7aHc2dqNSnjeOUhnqdgDjhTgER3G5W5w1ml3icbleoASYB8MZW8k7ec-B8ZUjk4kfEXbfCtW4w-eawAtQJJeErlTre7qVN5f4pC-8qbGY_B9bum0hkKXobObAeCL9wFOUS3qNJoSPT0exCRF_DRUDTelWLUlMJdJeBTJPuztFwUMQVAL7g-5xIYj29Nsn-VLBAPw8q1iMoJ-Mgmnvklqdwj0H54ri8nTzZqqEu6b0cMgXrPN3RcCHKdACk6q7s",
    createdAt: "3 days ago"
  }
];

export interface StyleOption {
  value: StyleType;
  label: string;
  imageUrl: string;
}

export const STYLE_OPTIONS: StyleOption[] = [
  {
    value: "Realistic",
    label: "Realistic",
    imageUrl: "https://lh3.googleusercontent.com/aida-public/AB6AXuAo7pqKAI2GRE8QUPgS6zvVw7BnDR1R5EHhSOF7lywWY4dJYUIG1nmqL-UxmVxmkwM2j73qzZE5IsZTlvADVyBJozypTtI2Opq3bCI0srouKaoWUAJo3_fA7HedZUtdFx4RHFPOH96ocK84E03nRdRmVHkcZC2SH8ssxrzQstJWYFuU258I7ROxUd1hPl0ZhPF0bp6w3t9k7EGPwGkolx3H5ccpbCAmbqgBJXGhZtVJiCux30iHWM1uRy-9F-axoajIx8USzunmZ6A"
  },
  {
    value: "Sketch",
    label: "Sketch",
    imageUrl: "https://lh3.googleusercontent.com/aida-public/AB6AXuBeJOqkT0kSrJGmVs4SUPMFCaXmPTfTmpz69kApSzaUyeUwJc-_AhfbfAKB9bC7cy9h42zpIjusLWUujDu2-UkcxU73GrFsXJfdbGxsEbW6vfAz9zmtDgk5AEVo0ncJoRWcMi6P61zQdLo68OKkEkX6LFUsRJE0ylG-0puEv2zt0jVAQQG7-1Y5YX8Akm1w3TAmBCw5yiURn_nkF4HEG3xgdOCumhP_RQTZwpTY6Kh1AGF8dKuwVj65pggBNRPneJWpuk0DqKhL6FU"
  },
  {
    value: "Clay",
    label: "Clay",
    imageUrl: "https://lh3.googleusercontent.com/aida/AP1WRLtdKKPaehwi0giiVJb_SykptocKAsxCw-OdKM1RqmDXyMIu5pT9c2EW_HSj4qhc3UNDb_x_4CqmJVn7NJNGOdyJUlCjbpjDGFKs48ByL0n5zfjY7wvV-F4XB12tlAHJrP945G3jJv9xAfsgpSkP_dIjN9Goai2gHlc8Nx4DTAZyLrF-Cxo2S_T5YKdWC5lyxvyS0IqQqnhIRRPGIxq7s0OjRPGvx968YmrF6Tp9S0_zYlfGLmTnTFtn8EQ"
  },
  {
    value: "Artistic",
    label: "Artistic",
    imageUrl: "https://lh3.googleusercontent.com/aida-public/AB6AXuAA04qZtEi14sni9xneFOMLIpFnEXeH0MVpDNDwDfdPKiZZkmf0KYxdHtHYa2InXwmGM3cYeothsDGDnk-K2T-A1JraFAgprom7I3mfIFdHW1E1naC2YTrAXIhS_GMXNf7OgOxHH4Nd12I3-3DKQlI4y0PM05rfg-i1CuZdiYumdC9vVMv_25m0QSwYBH7BuGrabVClFAY5eWYsP_IuNqOq3H_ID-Zl2Rp-aYBIjuHdrEAne6TnwcZQG8fKwlJOhowc99RBzDSnZNk"
  }
];

export interface BackgroundOption {
  value: BackgroundType;
  label: string;
  imageUrl: string;
}

export const BACKGROUND_OPTIONS: BackgroundOption[] = [
  {
    value: "Canyon",
    label: "Canyon",
    imageUrl: "https://lh3.googleusercontent.com/aida/AP1WRLuMUevcjZpP-AN97I_CA6dOQYEMS0BevxX3U39ALuZBdr-amMVOAtfxg8xCDxKyqZaseVEV-unjiFTjJh3qvOeeJK_FEcahmc-CSgTOIEsW_C9-BNmA7cgFVAjjQTQW0l1qQNz2RYiP8fzGVMjSgv3FD75s1qC_ghJQ5_sKyBUcPn7Gt74S_qwQy21Mq7ObaMtDVUR3Joq0QE0DwBDmKXXRXS21S-v6gRkS_EAKEwhLJiVOuOIm8xWZVQ"
  },
  {
    value: "Paris",
    label: "Paris",
    imageUrl: "https://lh3.googleusercontent.com/aida/AP1WRLu0a2zqhM8O_RZOwAwOQFiLUCNcaZ1ZMdzJrptZJEzBUJyQVdltY81Xz1jPThaWzxz_lQC81Yhk5ZDH5pEPucuOY63xYUYP2gYYtamwAasQck4iE1s5R-BRKLbbn4lIsPelp0wlUHhkx_MuV2IQQChqYRQzhkVA5w21uiLMSDROc6AXP4MNHjOCkbDRDMASrfbwrYbXp7pN6qNdnPagtho8jLTrmDddnMisxONscgNZDUlaLD09PEZM5D8"
  },
  {
    value: "Cabin",
    label: "Cabin",
    imageUrl: "https://lh3.googleusercontent.com/aida/AP1WRLtFDVEbGliaP7_evzZN_0TExPZntgmOewmauFKbkzvCbsDtKQs6KG-2t6XJ2X111LgZJF1OEymMFPWvAmWawCw-BCq6LT56LCOMv1teoRQytKnceBBh9acShCALXBygU3f_ABu8p4jiWEJVExClrbt0bTGdcCQ6GxFLGP4wYdtYKWhbchG9EG7JxIw39ErS7Lal4ujgb8uz8bxQOr-4H1dKF26Fv2zKJ4DWGHaAF7N7C4clV0ba9n8zADQ"
  },
  {
    value: "Rocky",
    label: "Rocky",
    imageUrl: "https://lh3.googleusercontent.com/aida/AP1WRLspAs6gAFb2pnpaVX6wcMLvr9o9n3oSE2QFQ2dTFyGxt_HBWbEYLDPj03M_9ZQ1fUm4TnfRYh0PeApgJZ2AGqbRdh1sv9_zZc6O1Z_2K6TS0Y3pXN3M9wGqtt7Dh5FnYaQNj0-HQ20O1ncRPGOjTHWhWj8817xOX71J2boQaFoxsJqqc4SZ3XDZ-gMCCQju26NPYT2d1qfjSYtikKrW1x4abnGrSDW_BDAYmhGFlm2aO349_5tBSXO7_CA"
  },
  {
    value: "Meadow",
    label: "Meadow",
    imageUrl: "https://lh3.googleusercontent.com/aida-public/AB6AXuBUGbgL9dsGLPEFfoCDKIkS-ehx4aHPq73SNZBpgtC8_FsyiQwQE8VHBd9ZPEQoB6LenVk4T1LYf3WtSkb-Ght5oSDhkzS0YepLnuDJcpuahVWxRckLHOyl7evJIkxIzJzBZy00b0NGaffKJhmuxQil_SV-ViXWr1HVcazqpxZKIXnzhoaaTV--YAxYrWuru1X7P7YFs3tIibqAcTtgqG1DRnqUBKpePBN7c4D6Ng63f8l5VQ4nA0LhCBzfD2cw3TJXvi8tswhOUYs"
  }
];
