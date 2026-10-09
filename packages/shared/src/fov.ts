// Default field of view (degrees) and range (feet) per device type, carried over from v1 so cameras and sensors
// placed without explicit values still draw their coverage. Generated from the v1 device library.
export const FOV_DEFAULTS: Readonly<Record<string, readonly [fov: number, rangeFt: number]>> = {
  's-motion': [110, 20], 's-presence': [120, 18], 'cam-fixed': [70, 30], 'cam-bullet': [80, 40], 'cam-dome': [95, 30], 'cam-ptz': [100, 60],
  'cam-lpr': [30, 80], 'cam-fisheye': [360, 25], 'cam-pano': [180, 35], 'cam-multi': [270, 40], 'doorbell': [160, 20], 'motion': [110, 25],
  'rex': [100, 8], 'ui-g6-turret': [110, 45], 'ui-g6-pro-turret': [114, 60], 'ui-g6-edge-turret': [114, 60], 'ui-g5-turret-ultra': [102, 35],
  'ui-ai-turret': [110, 60], 'ui-g6-dome': [110, 45], 'ui-g6-mini-dome': [110, 30], 'ui-g6-pro-dome': [114, 60], 'ui-g6-edge-dome': [114, 60],
  'ui-g5-dome': [102, 25], 'ui-g5-dome-ultra': [102, 30], 'ui-ai-dome': [110, 60], 'ui-g6-bullet': [110, 45], 'ui-g6-pro-bullet': [114, 60],
  'ui-g6-edge-bullet': [114, 80], 'ui-g5-bullet': [102, 40], 'ui-g5-pro': [80, 60], 'ui-ai-pro': [110, 60], 'ui-ai-lpr': [35, 100],
  'ui-g6-180': [180, 40], 'ui-g6-pro-360': [360, 30], 'ui-ai-360': [360, 25], 'ui-g6-ptz': [110, 80], 'ui-ai-ptz': [60, 200], 'ui-ai-ms2': [200, 50],
  'ui-ai-ms4': [360, 50], 'ui-g6-instant': [110, 25], 'ui-g5-flex': [102, 25], 'ui-doorbell-lite': [96, 20], 'ui-g4-db-pro': [138, 20],
  'ui-g6-entry': [100, 20], 'ui-g6-pro-entry': [100, 20], 'ui-ua-intercom': [110, 15], 'vg-c330': [79, 30], 'vg-c340': [79, 35], 'vg-c350': [82, 35],
  'vg-c385': [90, 45], 'vg-c430i': [79, 25], 'vg-c440i': [79, 30], 'vg-c440': [79, 30], 'vg-c450': [82, 35], 'vg-c455': [90, 35],
  'vg-c845': [90, 45], 'vg-c540': [84, 35], 'vg-c540s': [84, 35], 'vg-c540v': [84, 45], 'vg-c400hp': [90, 30], 'rl-510a': [80, 35],
  'rl-520a': [80, 30], 'rl-540a': [80, 30], 'rl-810a': [87, 45], 'rl-820a': [87, 40], 'rl-811a': [90, 60], 'rl-812a': [87, 40], 'rl-822a': [90, 55],
  'rl-824a': [90, 55], 'rl-830a': [87, 40], 'rl-833a': [90, 55], 'rl-840a': [87, 40], 'rl-842a': [90, 60], 'rl-843a': [90, 60],
  'rl-823a16': [96, 120], 'rl-823s1': [96, 70], 'rl-823s2': [96, 90], 'rl-81pa': [90, 45], 'rl-81ma': [180, 35], 'rl-1210a': [92, 50],
  'rl-1212a': [92, 55], 'rl-1220a': [92, 50], 'rl-1224a': [92, 50], 'rl-1240a': [145, 45], 'rl-cx410': [80, 35], 'rl-cx810': [87, 45],
  'rl-cx820': [87, 45], 'rl-duo2': [180, 35], 'rl-duo2v': [180, 35], 'rl-duo3': [180, 40], 'rl-duo3v': [180, 40], 'rl-duo-fl': [180, 40],
  'rl-elite-fl': [180, 45], 'rl-trackmix': [90, 60], 'rl-e1out': [90, 35], 'rl-e1out-se': [90, 40], 'rl-fe-p': [360, 25], 'rl-db-poe': [100, 20],
  'rl-b400': [80, 30], 'rl-d400': [80, 30], 'rl-b800': [87, 40], 'rl-d800': [87, 35], 'rl-b1200': [92, 50], 'rl-d1200': [92, 45],
  'am-ip8m-2496e': [112, 40], 'am-ip8m-t2599e': [112, 35], 'am-ip8m-2796e': [112, 35], 'am-ip8m-vt2779ew': [90, 50], 'am-ip4m-1026e': [90, 35],
  'am-ip5m-t1179e': [98, 30], 'am-ip4m-1063ew': [90, 100], 'am-ip5m-f1180e': [360, 25], 'am-ad410': [140, 20],
};
