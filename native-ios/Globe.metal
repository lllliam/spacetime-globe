#include <metal_stdlib>
using namespace metal;

// Matches GlobeUniforms; positions and widths use drawable pixels.
struct Camera {
    float4 centerRadiusZoom;
    float4 rotation;
    float4 drawableSelectionScale;
};

vertex float4 globeVertex(uint id [[vertex_id]]) {
    const float2 vertices[] = {{-1, -1}, {3, -1}, {-1, 3}};
    return float4(vertices[id], 0, 1);
}

static float3 toWorld(float3 p, float4 r) {
    float near = -p.y * r.w + p.z * r.z;
    return float3(p.x * r.x - near * r.y, p.y * r.z + p.z * r.w, p.x * r.y + near * r.x);
}

static float3 toView(float3 p, float4 r) {
    float near = -p.x * r.y + p.z * r.x;
    return float3(p.x * r.x + p.z * r.y, p.y * r.z - near * r.w, p.y * r.w + near * r.z);
}

static float2 mapUV(float3 p) {
    return float2(atan2(p.x, p.z) * 0.159154943 + 0.5,
                  0.5 - asin(clamp(p.y, -1.0, 1.0)) * 0.318309886);
}

static float3 spherePoint(float2 xy, float radius) {
    return normalize(float3(xy, sqrt(max(0.000001, radius*radius - dot(xy, xy)))));
}

static float2 acrossSeam(float2 delta) {
    return float2(delta.x - round(delta.x), delta.y);
}

fragment float4 globeFragment(float4 position [[position]],
                              constant Camera &camera [[buffer(0)]],
                              texture2d<float> earth [[texture(0)]],
                              texture2d<float> overlay [[texture(1)]],
                              texture2d<float> clouds [[texture(2)]],
                              texture2d<float> terrain [[texture(3)]],
                              sampler globeSampler [[sampler(0)]]) {
    constexpr sampler idSampler(coord::normalized, s_address::repeat, t_address::clamp_to_edge, filter::nearest);
    const float3 background(0.00304, 0.00518, 0.00802);
    const float3 light = normalize(float3(-0.43, 0.49, 0.76));
    const float radius = camera.centerRadiusZoom.z;
    const float zoom = camera.centerRadiusZoom.w;
    const float close = smoothstep(1.05, 3.6, zoom);
    const float2 pixel = float2(1, -1) / radius;
    const float2 xy = (position.xy - camera.centerRadiusZoom.xy) * pixel;
    const float distance = length(xy);
    const float sphere = 1.0 - smoothstep(-0.6, 0.6, (distance - 1.0) * radius);
    const float day = smoothstep(-0.35, 0.7, dot(normalize(float3(xy,0.26)), light));
    const float haze = exp(-max(0.0, distance - 1.0) * 80.0) * (1.0 - close*0.67);
    const float3 limb = background + float3(0.035, 0.075, 0.112) * haze * (0.28 + day*0.72);
    if (distance > 1.0 + max(0.057, 0.7/radius)) {
        return float4(background,1);
    }
    if (sphere <= 0.0) {
        return float4(limb,1);
    }

    const float4 rotation = camera.rotation;
    const float3 sphereNormal = spherePoint(xy,1.0);
    const float3 world = toWorld(sphereNormal,rotation);
    const float2 uv = mapUV(world);
    // Explicit neighboring rays preserve mip selection across the longitude seam.
    const float2 dx = acrossSeam(mapUV(toWorld(spherePoint(xy + float2(pixel.x,0),1),rotation)) - uv);
    const float2 dy = acrossSeam(mapUV(toWorld(spherePoint(xy + float2(0,pixel.y),1),rotation)) - uv);
    const gradient2d grad(dx,dy);
    const float3 base = earth.sample(globeSampler,uv,grad).rgb;
    const float3 ground = terrain.sample(globeSampler,uv,grad).rgb;
    const float land = smoothstep(0.18,0.83,ground.b);
    const float3 east = normalize(float3(world.z, 0.00001, -world.x));
    const float3 north = cross(world,east);
    const float2 slope = clamp((ground.rg - 128.0/255.0)*2.0,-1.0,1.0);
    const float detail = mix(0.30,0.93,close) * land * smoothstep(0.02,0.20,sphereNormal.z);
    const float3 normal = toView(normalize(world + detail * (east * slope.x + north * slope.y)),rotation);
    const float daylight = dot(sphereNormal,light);
    const float diffuse = clamp(dot(normal,light),-0.7,1.0);
    const float illumination = 0.27 + 0.76 * smoothstep(-0.52,0.9,daylight)
                                     + (diffuse-daylight) * 0.58;
    const float3 halfVector = normalize(light + float3(0,0,1));
    const float sheen = max(0.0,dot(sphereNormal,halfVector));
    const float reflection = (0.10*pow(sheen,80.0) + 0.026*pow(sheen,17.0)) *
                             (1.0-land) * smoothstep(0.0,0.30,daylight);
    const float coating = (1.0-close*0.91);
    const float cloudRadius = 1.014;
    const float3 shell = spherePoint(xy,cloudRadius);
    const float2 cloudUV = mapUV(toWorld(shell,rotation));
    const float3 groundToCloud = normalize(sphereNormal + light*(0.022/max(0.20,daylight)));
    const float4 shadowCloud = clouds.sample(globeSampler,mapUV(toWorld(groundToCloud,rotation)),grad);
    const float cloudShadow = shadowCloud.a * shadowCloud.r * coating * 0.23 * smoothstep(0.02,0.48,daylight);
    float3 color = (base*max(0.13,illumination) + reflection*float3(0.74,0.90,1.0))*(1-cloudShadow);

    const float4 coverage = overlay.sample(globeSampler,uv,grad);
    const float4 identity = overlay.sample(idSampler,uv,level(0));
    const float id = round(identity.r*255.0) + round(identity.g*255.0)*256.0;
    const float selected = (id > 0.0 && id == camera.drawableSelectionScale.z) ? 1.0 : 0.0;
    const float history = smoothstep(0.25,0.78,coverage.b);
    const float wash = coverage.a * (0.055 + history*(0.085+0.08*close)) + selected*0.13;
    const float luma = dot(color,float3(0.2126,0.7152,0.0722));
    color = mix(color, color*float3(1.14,1.01,0.79) + float3(0.09,0.052,0.014)*(0.34+luma), wash);

    const float4 cloud = clouds.sample(globeSampler,cloudUV,grad);
    const float cloudLight = 0.20 + 0.73 * smoothstep(-0.35,0.82,dot(shell,light));
    color = mix(color, float3(0.81,0.86,0.93)*cloudLight, cloud.r*cloud.a*coating*0.48);
    const float airPath = pow(1.0 - sphereNormal.z,3.6) * (1.0-close*0.72);
    color = mix(color,color*0.53 + float3(0.055,0.120,0.183)*(0.46+day*0.54),airPath*0.62);
    return float4(mix(limb,color,sphere),1);
}

struct BorderSegment { float4 first; float4 second; };
struct BorderVertex {
    float4 position [[position]];
    float2 distance;
    float length;
    float4 ink;
    float halfWidth;
};

vertex BorderVertex boundaryVertex(uint vertexID [[vertex_id]], uint segmentID [[instance_id]],
                                  constant Camera &camera [[buffer(0)]],
                                  const device BorderSegment *segments [[buffer(1)]],
                                  constant float4 &focused [[buffer(2)]]) {
    const BorderSegment edge = segments[segmentID];
    float3 a = toView(edge.first.xyz,camera.rotation);
    float3 b = toView(edge.second.xyz,camera.rotation);
    if (max(a.z,b.z) <= 0.0001) {
        return {float4(-2,-2,0,1),float2(0),0,float4(0),0};
    }
    if (a.z < 0) a = mix(a,b,-a.z/(b.z-a.z));
    if (b.z < 0) b = mix(b,a,-b.z/(a.z-b.z));
    const float2 center = camera.centerRadiusZoom.xy;
    const float2 scale = float2(1,-1)*camera.centerRadiusZoom.z;
    const float2 p = center + a.xy*scale, q = center + b.xy*scale;
    const float2 axis = q - p;
    const float span = max(0.001,length(axis));
    if (span <= 0.001) return {float4(-2,-2,0,1),float2(0),0,float4(0),0};

    const bool selected = edge.first.w == camera.drawableSelectionScale.z;
    const bool relevant = any(float4(edge.first.w) == focused);
    const float detail = smoothstep(1.0,3.2,camera.centerRadiusZoom.w);
    const float width = (selected ? 0.96 + detail*0.23 : (relevant ? 0.70 : 0.34) + detail*0.28) * camera.drawableSelectionScale.w;
    const float extent = width + 0.85;
    const float2 direction = axis/span, perpendicular = float2(-direction.y,direction.x);
    const float2 corners[] = {{0,-1},{1,-1},{0,1},{0,1},{1,-1},{1,1}};
    const float2 corner = corners[vertexID];
    const float along = corner.x > 0 ? span+extent : -extent;
    const float2 pixel = p + along*direction + corner.y*extent*perpendicular;
    const float2 clip = pixel/camera.drawableSelectionScale.xy*float2(2,-2) + float2(-1,1);
    const float fade = smoothstep(0.0,0.14,max(a.z,b.z));
    const float4 ink = selected ? float4(0.93,0.74,0.40,0.94) :
                                   (relevant ? float4(0.77,0.62,0.38,0.78) :
                                               float4(0.45,0.37,0.24,0.29 + 0.27*detail));
    return {float4(clip,0,1), float2(along,corner.y*extent),span, float4(ink.rgb,ink.a*fade),width};
}

fragment float4 boundaryFragment(BorderVertex in [[stage_in]]) {
    const float outside = max(max(-in.distance.x,in.distance.x-in.length),0.0);
    const float d = length(float2(outside,in.distance.y));
    const float alpha = (1.0 - smoothstep(in.halfWidth-0.65,in.halfWidth+0.65,d)) * in.ink.a;
    return float4(in.ink.rgb*alpha,alpha);
}
