-- Runs after the postgis image's own init scripts (alphabetical order).
-- Creates the pytest database with PostGIS enabled explicitly (no template dependency).
CREATE DATABASE depo_test;
\connect depo_test
CREATE EXTENSION IF NOT EXISTS postgis;
