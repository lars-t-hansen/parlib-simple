// Generated from ray-common.flat_js by fjsc 0.5; github.com/lars-t-hansen/flatjs
/* -*- mode: javascript -*- */

/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Author: Lars T Hansen, lth@acm.org / lhansen@mozilla.com
 */

// CONFIGURATION

const g_height = 600;
const g_width = 800;

const g_shadows = true;		// Compute object shadows
const g_reflection = true;	// Compute object reflections
const g_reflection_depth = 2;
const g_antialias = false;	// Antialias the image (expensive but very pretty)

const g_left = -2;
const g_right = 2;
const g_top = 1.5;
const g_bottom = -1.5;

// END CONFIGURATION

const debug = false;		// Progress printout, may confuse the consumer

const SENTINEL = 1e32;
const EPS = 0.00001;

function DL3(x, y, z) { return {x:x, y:y, z:z}; }

function add(a, b) { return DL3(a.x+b.x, a.y+b.y, a.z+b.z); }
function addi(a, c) { return DL3(a.x+c, a.y+c, a.z+c); }
function sub(a, b) { return DL3(a.x-b.x, a.y-b.y, a.z-b.z); }
function subi(a, c) { return DL3(a.x-c, a.y-c, a.z-c); }
function muli(a, c) { return DL3(a.x*c, a.y*c, a.z*c); }
function divi(a, c) { return DL3(a.x/c, a.y/c, a.z/c); }
function neg(a) { return DL3(-a.x, -a.y, -a.z); }
function length(a) { return Math.sqrt(a.x*a.x + a.y*a.y + a.z*a.z); }
function normalize(a) { var d = length(a); return DL3(a.x/d, a.y/d, a.z/d); }
function cross(a, b) { return DL3(a.y*b.z - a.z*b.y, a.z*b.x - a.x*b.z, a.x*b.y - a.y*b.x); }
function dot(a, b) { return a.x*b.x + a.y*b.y + a.z*b.z; }

function Vec3() {}
Vec3.NAME = "Vec3";
Vec3.SIZE = 24;
Vec3.ALIGN = 8;
Vec3._get_impl = function (SELF) {
	return DL3(_mem_float64[(SELF + 0) >> 3], _mem_float64[(SELF + 8) >> 3], _mem_float64[(SELF + 16) >> 3]);
    }
Vec3._set_impl = function (SELF, v) {
  _mem_float64[(SELF + 0) >> 3] = (v.x);
  _mem_float64[(SELF + 8) >> 3] = (v.y);
  _mem_float64[(SELF + 16) >> 3] = (v.z);
}

// Avoid intermediate DL3 objects

function subvref(a, b) { return DL3(a.x-_mem_float64[(b + 0) >> 3], a.y-_mem_float64[(b + 8) >> 3], a.z-_mem_float64[(b + 16) >> 3]); }
function subrefref(a, b) { return DL3(_mem_float64[(a + 0) >> 3]-_mem_float64[(b + 0) >> 3], _mem_float64[(a + 8) >> 3]-_mem_float64[(b + 8) >> 3], _mem_float64[(a + 16) >> 3]-_mem_float64[(b + 16) >> 3]); }
function mulrefi(a, c) { return DL3(_mem_float64[(a + 0) >> 3]*c, _mem_float64[(a + 8) >> 3]*c, _mem_float64[(a + 16) >> 3]*c); }

function Material() {}
Material.NAME = "Material";
Material.SIZE = 88;
Material.ALIGN = 8;
Material._get_impl = function (SELF) {
  var v = new Material;
  v.diffuse = Vec3._get_impl((SELF + 0));
  v.specular = Vec3._get_impl((SELF + 24));
  v.shininess = _mem_float64[(SELF + 48) >> 3];
  v.ambient = Vec3._get_impl((SELF + 56));
  v.mirror = _mem_float64[(SELF + 80) >> 3];
  return v;
}
Material._set_impl = function (SELF, v) {
  Vec3._set_impl((SELF + 0), (v.diffuse));
  Vec3._set_impl((SELF + 24), (v.specular));
  _mem_float64[(SELF + 48) >> 3] = (v.shininess);
  Vec3._set_impl((SELF + 56), (v.ambient));
  _mem_float64[(SELF + 80) >> 3] = (v.mirror);
}

function makeMaterial(diffuse, specular, shininess, ambient, mirror) {
    var v = new Material;
    v.diffuse = diffuse;
    v.specular = specular;
    v.shininess = shininess;
    v.ambient = ambient;
    v.mirror = mirror;
    return v;
}

function Surface(p) { this._pointer = (p|0); }
Object.defineProperty(Surface.prototype, 'pointer', { get: function () { return this._pointer } });
Surface.NAME = "Surface";
Surface.SIZE = 96;
Surface.ALIGN = 8;
Surface.CLSID = 12421246;
Object.defineProperty(Surface, 'BASE', {get: function () { return null; }});
Surface.init = function (SELF, material) {
	 Material._set_impl((SELF + 8), material); 
	return SELF;
    }
Surface.intersect_impl = function (SELF, eye, ray, min, max) {
	throw "Pure: Surface.intersect"
    }
Surface.normal_impl = function (SELF, p) {
	throw "Pure: Surface.normal"
    }
Surface.intersect = function (SELF , eye,ray,min,max) {
  switch (_mem_int32[SELF>>2]) {
    case 12421246:
      return Surface.intersect_impl(SELF , eye,ray,min,max);
    case 31908292:
      return Scene.intersect_impl(SELF , eye,ray,min,max);
    case 255127510:
      return Sphere.intersect_impl(SELF , eye,ray,min,max);
    case 217195274:
      return Triangle.intersect_impl(SELF , eye,ray,min,max);
    default:
      throw FlatJS._badType(SELF);
  }
}
Surface.normal = function (SELF , p) {
  switch (_mem_int32[SELF>>2]) {
    case 12421246:
    case 31908292:
      return Surface.normal_impl(SELF , p);
    case 255127510:
      return Sphere.normal_impl(SELF , p);
    case 217195274:
      return Triangle.normal_impl(SELF , p);
    default:
      throw FlatJS._badType(SELF);
  }
}
Surface.initInstance = function(SELF) { _mem_int32[SELF>>2]=12421246; return SELF; }
FlatJS._idToType[12421246] = Surface;

function Scene(p) { this._pointer = (p|0); }
Scene.prototype = new Surface;
Scene.NAME = "Scene";
Scene.SIZE = 104;
Scene.ALIGN = 8;
Scene.CLSID = 31908292;
Object.defineProperty(Scene, 'BASE', {get: function () { return Surface; }});
Scene.init = function (SELF, objects) {
	var len = objects.length;
	 _mem_int32[(SELF + 96) >> 2] = len; 
	var objs = FlatJS.allocOrThrow(4 * len, 4);
	for ( var i=0 ; i < len ; i++ )
	    _mem_int32[(objs+4*i) >> 2] = (objects[i]);
	 _mem_int32[(SELF + 100) >> 2] = objs; 
	return SELF;
    }
Scene.intersect_impl = function (SELF, eye, ray, min, max) {
	var min_obj = NULL;
	var min_dist = SENTINEL;

	var objs = _mem_int32[(SELF + 100) >> 2];
	for ( var idx=0, limit=_mem_int32[(SELF + 96) >> 2] ; idx < limit ; idx++ ) {
	    var surf = _mem_int32[(objs+4*idx) >> 2];
	    var tmp = Surface.intersect(surf, eye, ray, min, max);
	    var obj = tmp.obj;
	    var dist = tmp.dist;
	    if (obj)
		if (dist >= min && dist < max)
		    if (dist < min_dist) {
			min_obj = obj;
			min_dist = dist;
		    }
	}
	return {obj:min_obj, dist:min_dist};
    }
Scene.intersect = function (SELF , eye,ray,min,max) {
  switch (_mem_int32[SELF>>2]) {
    case 31908292:
      return Scene.intersect_impl(SELF , eye,ray,min,max);
    default:
      throw FlatJS._badType(SELF);
  }
}
Scene.normal = function (SELF , p) {
  switch (_mem_int32[SELF>>2]) {
    default:
      return Surface.normal_impl(SELF , p);
  }
}
Scene.initInstance = function(SELF) { _mem_int32[SELF>>2]=31908292; return SELF; }
FlatJS._idToType[31908292] = Scene;

function Sphere(p) { this._pointer = (p|0); }
Sphere.prototype = new Surface;
Sphere.NAME = "Sphere";
Sphere.SIZE = 128;
Sphere.ALIGN = 8;
Sphere.CLSID = 255127510;
Object.defineProperty(Sphere, 'BASE', {get: function () { return Surface; }});
Sphere.init = function (SELF, material, center, radius) {
	Surface.init(SELF, material)
	 Vec3._set_impl((SELF + 96), center); 
	 _mem_float64[(SELF + 120) >> 3] = radius 
	return SELF;
    }
Sphere.intersect_impl = function (SELF, eye, ray, min, max) {
	var DdotD = dot(ray, ray);
	var EminusC = subvref(eye, (SELF + 96));
	var B = dot(ray, EminusC);
	var disc = B*B - DdotD*(dot(EminusC,EminusC) - _mem_float64[(SELF + 120) >> 3]*_mem_float64[(SELF + 120) >> 3]);
	if (disc < 0.0)
	    return {obj:NULL, dist:0};
	var s1 = (-B + Math.sqrt(disc))/DdotD;
	var s2 = (-B - Math.sqrt(disc))/DdotD;
	// Here return the smallest of s1 and s2 after filtering for _min and _max
	if (s1 < min || s1 > max)
	    s1 = SENTINEL;
	if (s2 < min || s2 > max)
	    s2 = SENTINEL;
	var _dist = Math.min(s1,s2);
	if (_dist == SENTINEL)
	    return {obj:NULL, dist:0};
	return {obj:SELF, dist:_dist};
    }
Sphere.normal_impl = function (SELF, p) {
	return divi(subvref(p, (SELF + 96)), _mem_float64[(SELF + 120) >> 3]);
    }
Sphere.intersect = function (SELF , eye,ray,min,max) {
  switch (_mem_int32[SELF>>2]) {
    case 255127510:
      return Sphere.intersect_impl(SELF , eye,ray,min,max);
    default:
      throw FlatJS._badType(SELF);
  }
}
Sphere.normal = function (SELF , p) {
  switch (_mem_int32[SELF>>2]) {
    case 255127510:
      return Sphere.normal_impl(SELF , p);
    default:
      throw FlatJS._badType(SELF);
  }
}
Sphere.initInstance = function(SELF) { _mem_int32[SELF>>2]=255127510; return SELF; }
FlatJS._idToType[255127510] = Sphere;

function Triangle(p) { this._pointer = (p|0); }
Triangle.prototype = new Surface;
Triangle.NAME = "Triangle";
Triangle.SIZE = 168;
Triangle.ALIGN = 8;
Triangle.CLSID = 217195274;
Object.defineProperty(Triangle, 'BASE', {get: function () { return Surface; }});
Triangle.init = function (SELF, material, v1, v2, v3) {
	Surface.init(SELF, material)
	 Vec3._set_impl((SELF + 96), v1); 
	 Vec3._set_impl((SELF + 120), v2); 
	 Vec3._set_impl((SELF + 144), v3); 
	return SELF;
    }
Triangle.intersect_impl = function (SELF, eye, ray, min, max) {
	// TODO: observe that values that do not depend on g, h, and i can be precomputed
	// and stored with the triangle (for a given eye position), at some (possibly significant)
	// space cost.  Notably the numerator of "t" is invariant, as are many factors of the
	// numerator of "gamma".
	var a = _mem_float64[(SELF + 96) >> 3] - _mem_float64[(SELF + 120) >> 3];
	var b = _mem_float64[(SELF + 104) >> 3] - _mem_float64[(SELF + 128) >> 3];
	var c = _mem_float64[(SELF + 112) >> 3] - _mem_float64[(SELF + 136) >> 3];
	var d = _mem_float64[(SELF + 96) >> 3] - _mem_float64[(SELF + 144) >> 3];
	var e = _mem_float64[(SELF + 104) >> 3] - _mem_float64[(SELF + 152) >> 3];
	var f = _mem_float64[(SELF + 112) >> 3] - _mem_float64[(SELF + 160) >> 3];
	var g = ray.x;
	var h = ray.y;
	var i = ray.z;
	var j = _mem_float64[(SELF + 96) >> 3] - eye.x;
	var k = _mem_float64[(SELF + 104) >> 3] - eye.y;
	var l = _mem_float64[(SELF + 112) >> 3] - eye.z;
	var M = a*(e*i - h*f) + b*(g*f - d*i) + c*(d*h - e*g);
	var t = -((f*(a*k - j*b) + e*(j*c - a*l) + d*(b*l - k*c))/M);
	if (t < min || t > max)
	    return {obj:NULL,dist:0};
	var gamma = (i*(a*k - j*b) + h*(j*c - a*l) + g*(b*l - k*c))/M;
	if (gamma < 0 || gamma > 1.0)
	    return {obj:NULL,dist:0};
	var beta = (j*(e*i - h*f) + k*(g*f - d*i) + l*(d*h - e*g))/M;
	if (beta < 0.0 || beta > 1.0 - gamma)
	    return {obj:NULL,dist:0};
	return {obj:SELF, dist:t};
    }
Triangle.normal_impl = function (SELF, p) {
	// TODO: Observe that the normal is invariant and can be stored with the triangle
	return normalize(cross(subrefref((SELF + 120), (SELF + 96)), subrefref((SELF + 144), (SELF + 96))));
    }
Triangle.intersect = function (SELF , eye,ray,min,max) {
  switch (_mem_int32[SELF>>2]) {
    case 217195274:
      return Triangle.intersect_impl(SELF , eye,ray,min,max);
    default:
      throw FlatJS._badType(SELF);
  }
}
Triangle.normal = function (SELF , p) {
  switch (_mem_int32[SELF>>2]) {
    case 217195274:
      return Triangle.normal_impl(SELF , p);
    default:
      throw FlatJS._badType(SELF);
  }
}
Triangle.initInstance = function(SELF) { _mem_int32[SELF>>2]=217195274; return SELF; }
FlatJS._idToType[217195274] = Triangle;

function Bitmap(p) { this._pointer = (p|0); }
Object.defineProperty(Bitmap.prototype, 'pointer', { get: function () { return this._pointer } });
Bitmap.NAME = "Bitmap";
Bitmap.SIZE = 16;
Bitmap.ALIGN = 4;
Bitmap.CLSID = 1766265;
Object.defineProperty(Bitmap, 'BASE', {get: function () { return null; }});
Bitmap.init = function (SELF, height, width, color) {
	 _mem_int32[(SELF + 8) >> 2] = height; 
	 _mem_int32[(SELF + 12) >> 2] = width; 
	var data = FlatJS.allocOrThrow(4 * (height*width), 4);
	var c = (255<<24)|((255*color.z)<<16)|((255*color.y)<<8)|(255*color.x)
	for ( var i=0, l=width*height ; i < l ; i++ )
	    _mem_int32[(data+4*i) >> 2] = c;
	 _mem_int32[(SELF + 4) >> 2] = data; 
	return SELF;
    }

    // For debugging only
Bitmap.ref = function (SELF, y, x) {
	return _mem_int32[((_mem_int32[(SELF + 4) >> 2])+4*((_mem_int32[(SELF + 8) >> 2]-y)*_mem_int32[(SELF + 12) >> 2]+x)) >> 2];
    }

    // Not a hot function
Bitmap.setColor = function (SELF, y, x, v) {
	_mem_int32[((_mem_int32[(SELF + 4) >> 2])+4*((_mem_int32[(SELF + 8) >> 2]-y-1)*_mem_int32[(SELF + 12) >> 2]+x)) >> 2] = ((255<<24)|((255*v.z)<<16)|((255*v.y)<<8)|(255*v.x));
    }
Bitmap.initInstance = function(SELF) { _mem_int32[SELF>>2]=1766265; return SELF; }
FlatJS._idToType[1766265] = Bitmap;
