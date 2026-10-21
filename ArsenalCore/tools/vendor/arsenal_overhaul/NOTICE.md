# ArsenalOverhaul 1.0.7 から流用した素材

作者：anfaal1672（ARSENAL CORE と同じ作者）／ライセンス：MIT（パックの manifest.json の metadata）

- `particles/*.json` … 発射炎・発射光・硝煙・曳光弾・薬莢・着弾の破片と土煙・火花・血しぶき・命中の光（3.0.0 で ARSENAL CORE の同じ役割のパーティクルと置き換え。`tools/gen/particles.py` が識別子とテクスチャの場所だけを書き換えて書き出す）
- `particles.png` … 上のパーティクルのテクスチャ（128×128）
- 反動・ボルト操作・点検のモーション … `tools/riggen.py` にキーフレームの値を写した（`animation.gun.player.recoil_*`／`bolt`／`inspect`）
