/**
 * Dropdown filtre custom — remplace les <select> natifs.
 * Chaque .filter-dropdown contient :
 *   - un bouton .filter-dropdown-btn  (trigger Bootstrap dropdown)
 *   - une ul.filter-dropdown-menu     (liste des options)
 *   - un input[type=hidden]           (valeur transmise au formulaire)
 *
 * Au clic sur un item :
 *   1. Met à jour le champ caché
 *   2. Met à jour le libellé du bouton
 *   3. Marque l'item actif (✓)
 */
(function () {
    'use strict';

    document.querySelectorAll('.filter-dropdown').forEach(function (wrapper) {
        var btn    = wrapper.querySelector('.filter-dropdown-btn');
        var label  = wrapper.querySelector('.filter-dropdown-label');
        var hidden = wrapper.querySelector('input[type="hidden"]');
        var items  = wrapper.querySelectorAll('.dropdown-item');

        if (!btn || !label || !hidden) return;

        /* Synchroniser le libellé du bouton avec l'item actif au chargement */
        var activeItem = wrapper.querySelector('.dropdown-item.active');
        if (activeItem) {
            label.textContent = activeItem.querySelector('.filter-dropdown-option-label')
                                ? activeItem.querySelector('.filter-dropdown-option-label').textContent.trim()
                                : activeItem.textContent.trim();
        }

        items.forEach(function (item) {
            item.addEventListener('click', function (e) {
                e.preventDefault();

                /* Valeur → champ caché */
                hidden.value = this.dataset.value;

                /* Libellé → bouton */
                var optLabel = this.querySelector('.filter-dropdown-option-label');
                label.textContent = optLabel
                    ? optLabel.textContent.trim()
                    : this.textContent.trim();

                /* Marqueur actif */
                items.forEach(function (i) {
                    i.classList.remove('active');
                    var chk = i.querySelector('.filter-dropdown-check');
                    if (chk) chk.style.visibility = 'hidden';
                });
                this.classList.add('active');
                var myChk = this.querySelector('.filter-dropdown-check');
                if (myChk) myChk.style.visibility = 'visible';
            });
        });
    });
})();
