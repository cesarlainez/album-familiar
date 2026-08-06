/* ══════════════════════════════════════════════════════════════
   SERVICIO SUPABASE — Acceso a la base de datos del SaaS
   ──────────────────────────────────────────────────────────────
   Requiere que el SDK UMD de supabase-js esté cargado antes (index.html
   lo trae por CDN y expone `window.supabase`).

   Expone una única responsabilidad: traer los perfiles de un tenant.
   El resto de la app no sabe que Supabase existe; habla con AlbumDatos.
   ══════════════════════════════════════════════════════════════ */

(function (global) {
  'use strict';

  let _cliente = null;

  function cliente() {
    if (_cliente) return _cliente;
    const cfg = global.ALBUM_CONFIG;
    if (!global.supabase || !global.supabase.createClient) {
      throw new Error('El SDK de Supabase no está cargado.');
    }
    _cliente = global.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);
    return _cliente;
  }

  const SupabaseServicio = {
    /** Trae los perfiles del tenant. El filtrado por id_familia se refuerza
     *  en el servidor con RLS: aunque alguien manipule esta consulta, la
     *  política solo devuelve filas de su propia familia. */
    async obtenerPerfiles(idFamilia) {
      const { data, error } = await cliente()
        .from('perfiles')
        .select(
          'id_familia, id, nombre_completo, fecha_nacimiento, fecha_fallecimiento,' +
          ' disciplina_artistica, obra_maestra, biografia, galeria, id_padre, id_madre, id_pareja'
        )
        .eq('id_familia', idFamilia)
        .order('fecha_nacimiento', { ascending: true });

      if (error) throw error;
      return data || [];
    },

    /** Lista los id_familia distintos.
     *  Nota: con RLS por tenant esto devolverá solo la familia del usuario.
     *  Para un selector multi-tenant real, crea en backend una función
     *  `listar_familias()` SECURITY DEFINER y usa cliente().rpc('listar_familias'). */
    async listarFamilias() {
      const { data, error } = await cliente().from('perfiles').select('id_familia');
      if (error) throw error;
      return [...new Set((data || []).map((r) => r.id_familia))].sort();
    },

    /** Inserta un perfil y devuelve la fila creada. */
    async crear(perfil) {
      const { data, error } = await cliente().from('perfiles').insert(perfil).select().single();
      if (error) throw error;
      return data;
    },

    /** Actualiza campos de un perfil (por tenant + id). */
    async actualizar(idFamilia, id, cambios) {
      const { error } = await cliente()
        .from('perfiles')
        .update(cambios)
        .eq('id_familia', idFamilia)
        .eq('id', id);
      if (error) throw error;
    },

    /** Elimina un perfil. Antes limpia las referencias que otros le hacían
     *  en id_pareja (que es un array, no una FK, así que no se limpia solo).
     *  id_padre / id_madre se anulan por la FK `on delete set null`. */
    async eliminar(idFamilia, id) {
      const c = cliente();

      const { data: conPareja, error: e1 } = await c
        .from('perfiles')
        .select('id, id_pareja')
        .eq('id_familia', idFamilia)
        .contains('id_pareja', [id]);
      if (e1) throw e1;

      for (const fila of conPareja || []) {
        const limpio = (fila.id_pareja || []).filter((x) => x !== id);
        const { error: e2 } = await c
          .from('perfiles')
          .update({ id_pareja: limpio })
          .eq('id_familia', idFamilia)
          .eq('id', fila.id);
        if (e2) throw e2;
      }

      const { error: e3 } = await c
        .from('perfiles')
        .delete()
        .eq('id_familia', idFamilia)
        .eq('id', id);
      if (e3) throw e3;
    },
  };

  global.SupabaseServicio = SupabaseServicio;
})(window);
