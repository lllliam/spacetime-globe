"""Build the terrain texture from GMT Earth Relief and Natural Earth polygons.

Usage: python tools/build-terrain.py earth_relief_05m.grd ne_50m_land.zip ne_50m_lakes.zip
Requires numpy, h5py, Pillow and pyshp. The runtime and site build only need the PNG.
"""

import argparse
from pathlib import Path

import h5py
import numpy as np
from PIL import Image, ImageDraw
import shapefile


WIDTH, HEIGHT = 4096, 2048
EARTH_RADIUS = 6_371_000
NORMAL_RANGE = 0.42


def elevation_at_texels(path):
    with h5py.File(path) as grid:
        z = grid['z']
        if z.shape != (2161, 4321) or tuple(grid['lon'][:][[0, -1]]) != (-180, 180) \
                or tuple(grid['lat'][:][[0, -1]]) != (-90, 90):
            raise ValueError('Expected the global, gridline-registered 5 arc minute GMT grid')
        scale = np.asarray(z.attrs.get('scale_factor', 1)).item()
        offset = np.asarray(z.attrs.get('add_offset', 0)).item()
        samples = z[:].astype(np.float32) * scale + offset

    # The source includes both endpoints. The texture samples the centers of its pixels.
    x = (np.arange(WIDTH) + 0.5) * 4320 / WIDTH
    y = (np.arange(HEIGHT) + 0.5) * 2160 / HEIGHT
    xi, yi = x.astype(int), y.astype(int)
    fx, fy = (x - xi).astype(np.float32), (y - yi).astype(np.float32)[:, None]
    north_first = samples[::-1]
    columns = north_first[:, xi] * (1 - fx) + north_first[:, xi + 1] * fx
    return columns[yi] * (1 - fy) + columns[yi + 1] * fy


def land_coverage(land_path, lakes_path):
    # Rasterize physical coastlines at twice the target size for fractional coastal pixels.
    mask = Image.new('L', (WIDTH * 2, HEIGHT * 2))
    draw = ImageDraw.Draw(mask)
    for path, color in ((land_path, 255), (lakes_path, 0)):
        with shapefile.Reader(str(path)) as shapes:
            for shape in shapes.iterShapes():
                geometry = shape.__geo_interface__
                polygons = geometry['coordinates']
                if geometry['type'] == 'Polygon':
                    polygons = [polygons]
                for polygon in polygons:
                    for index, ring in enumerate(polygon):
                        points = [
                            ((lon + 180) / 180 * WIDTH, (90 - lat) / 90 * HEIGHT)
                            for lon, lat in ring
                        ]
                        if len(points) >= 3:
                            draw.polygon(points, fill=color if index == 0 else 255 - color)
    return np.asarray(mask.resize((WIDTH, HEIGHT), Image.Resampling.BOX))


def encode_terrain(elevation, land):
    cos_latitude = np.sin((np.arange(HEIGHT, dtype=np.float32) + 0.5) * np.pi / HEIGHT)[:, None]
    spacing = EARTH_RADIUS * np.pi / HEIGHT
    # Central differences in meters, with wrapping at the date line.
    east = (np.roll(elevation, -1, axis=1) - np.roll(elevation, 1, axis=1)) / (
        2 * spacing * np.maximum(cos_latitude, 0.12)
    )
    north = np.gradient(elevation, -spacing, axis=0)
    normal_length = np.sqrt(1 + east * east + north * north)
    # Near the poles longitude spacing collapses and the tangent basis becomes unstable.
    fade = np.clip((cos_latitude - 0.06) / 0.20, 0, 1)
    fade *= fade * (3 - 2 * fade)
    fade = fade * (land.astype(np.float32) / 255)
    channels = [
        np.rint(128 - np.clip(slope / normal_length * fade / NORMAL_RANGE, -1, 1) * 127).astype(np.uint8)
        for slope in (east, north)
    ]
    return Image.fromarray(np.dstack((*channels, land)))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('elevation', type=Path)
    parser.add_argument('land', type=Path)
    parser.add_argument('lakes', type=Path)
    args = parser.parse_args()
    output = Path(__file__).resolve().parents[1] / 'data' / 'terrain-4k-v1.png'
    encode_terrain(elevation_at_texels(args.elevation), land_coverage(args.land, args.lakes)).save(
        output, optimize=True
    )
    print(f'{output.name}: {WIDTH} × {HEIGHT}, {output.stat().st_size:,} bytes')


if __name__ == '__main__':
    main()
