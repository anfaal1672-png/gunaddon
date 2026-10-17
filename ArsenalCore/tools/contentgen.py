"""
ARSENAL CORE — BP / RP コンテンツ生成（入口）
実体は tools/gen/ 以下のモジュールに分かれている。build.py はこの Gen を使う。
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from gen.common import GenBase, wjson, wpng, item_json, is_scoped, NS  # noqa: E402,F401
from gen.weapons import WeaponsMixin  # noqa: E402
from gen.items import ItemsMixin  # noqa: E402
from gen.armor import ArmorMixin  # noqa: E402
from gen.gear import GearMixin  # noqa: E402
from gen.blocks import BlocksMixin  # noqa: E402
from gen.recipes import RecipesMixin  # noqa: E402
from gen.entities import EntitiesMixin  # noqa: E402
from gen.entities2 import Entities2Mixin  # noqa: E402
from gen.structures import StructuresMixin  # noqa: E402
from gen.loot import LootMixin  # noqa: E402
from gen.particles import ParticlesMixin  # noqa: E402
from gen.sounds import SoundsMixin  # noqa: E402
from gen.ui import UiMixin  # noqa: E402
from gen.finish import FinishMixin  # noqa: E402


class Gen(WeaponsMixin, ItemsMixin, ArmorMixin, GearMixin, BlocksMixin, RecipesMixin, EntitiesMixin, Entities2Mixin, StructuresMixin,
          LootMixin, ParticlesMixin, SoundsMixin, UiMixin, FinishMixin, GenBase):
    """すべての生成処理をまとめたクラス"""
